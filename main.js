const profiles = [
	{ 
		cred: "xxxxxxxxxxxxxxxxxxxxxxxx",
		accountName: "xxxxxxxxxxxxxxxxx"
	}
];

const discordApp = [
	{
		notify: false,
		myDiscordID: 'xxxxxxxxxxxxxxxxxxxxxxxx',
		discordWebhook: 'https://discord.com/api/webhooks/xxxxxxxxxxxxxxxxxxxxxxxx/xxxxxxxxxxxxxxxxxxxxxxxx'
	}
];

const telegramApp = [
	{
		notify: false,
		myTelegramID: 'xxxxx',
		telegramBotToken: 'xxxxxx:xxxxxxxx'
	}
];

const Settings = {
	platform: "3",
	vName: "1.0.0",
	appCode: "endfield",
	retry: { max: 3, initialBackoffMs: 500 },
	endpoints: {
		refresh: "https://zonai.skport.com/web/v1/auth/refresh",
		binding: "https://zonai.skport.com/api/v1/game/player/binding",
		attendance: "https://zonai.skport.com/web/v1/game/endfield/attendance"
	},
	userAgent: "Mozilla/5.0",
	defaultHeaders: {
		accept: "application/json, text/plain, */*",
		origin: "https://game.skport.com",
		referer: "https://game.skport.com/"
	},
	baseAttHeaders: {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br, zstd",
		Referer: "https://game.skport.com/",
		"Content-Type": "application/json",
		"sk-language": "en",
		Origin: "https://game.skport.com",
		Connection: "keep-alive",
		"Sec-Fetch-Dest": "empty",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Site": "same-site"
	},
	chunkSize: 20,
	discordColumn: 2,
	successCodes: new Set([0, 10001])
};

function main() {
	if (!profiles.length) return [];
	const { max: maxRetry = 1, initialBackoffMs: backoff = 500 } = Settings.retry || {};

	let tokens = chunkedFetchAll(profiles.map(buildTokenRefresh)).map(r => ((m = readMeta(r)) => m?.code === 10002 ? "" : (m?.json?.data?.token ?? null))());
	for (let a = 1, f; (f = tokens.map((t, i) => t === null ? i : -1).filter(i => i !== -1)).length && a < maxRetry; a++) {
		Utilities.sleep(backoff << a);
		chunkedFetchAll(f.map(i => buildTokenRefresht(profiles[i])))
			.forEach((r, k) => tokens[f[k]] = ((m = readMeta(r)) => m?.code === 10002 ? "" : (m?.json?.data?.token ?? null))());
	}

	const resolved = profiles.map((p, i) => {
		const token = tokens[i];
		return (token === "" || token === null)
			? { ...p, token, skGameRole: p.skGameRole || "", nickname: p.accountName || "", serverName: p.serverName || "" }
			: { ...p, token };
	});

	const bindIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (bindIdx.length) {
		chunkedFetchAll(
			bindIdx.map(i => buildPlayerBindingRequest(resolved[i].cred || "", resolved[i].token))
		).forEach((r, k) => resolved[bindIdx[k]].bind = readMeta(r));
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.bind))
			.filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			Utilities.sleep(backoff << a);
			chunkedFetchAll(
				f.map(i => buildPlayerBindingRequest(resolved[i].cred || "", resolved[i].token))
			).forEach((r, k) => resolved[f[k]].bind = readMeta(r));
		}

		bindIdx.forEach(i => {
			const j = resolved[i].bind?.json;
			const app = j?.code === 0 ? j?.data?.list?.find(a => a.appCode === Settings.appCode && a.bindingList?.length) : null;
			const b = app?.bindingList?.[0];
			const role = b?.defaultRole || b?.roles?.[0];

			resolved[i] = {
				...resolved[i],
				skGameRole: role?.roleId && role?.serverId ? `${b.gameId}_${role.roleId}_${role.serverId}` : (resolved[i].skGameRole || ""),
				nickname: role?.nickname || resolved[i].accountName || "",
				serverName: role?.serverName || resolved[i].serverName || ""
			};
		});
	}

	const reqIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (reqIdx.length) {
		chunkedFetchAll(
			reqIdx.map(i => buildAttendRequest(resolved[i], resolved[i].token, nowTs()))
		).map(readMeta)
		 .forEach((m, k) => resolved[reqIdx[k]].meta = m);
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.meta)).filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			Utilities.sleep(backoff << a);
			chunkedFetchAll(
				f.map(i => buildAttendRequest(resolved[i], resolved[i].token, nowTs()))
			).map(readMeta)
			 .forEach((m, k) => resolved[f[k]].meta = m);
		}
	}

	const results = resolved.map((p, i) => formatResult(p, p.meta, i));
	discordPost(results);
	telegramPost(results);
	return results;
}

function formatResult(p, meta, i) {
	const nickname = p.nickname || `#${i + 1}`;
	const serverName = p.serverName || "";
	const out = { nickname, serverName, success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000) };

	if (!meta?.json) {
		out.status = "💥 Invalid JSON / Fetch Failed";
		out.msg = meta?.rawText || "No response";
		console.log(`[${nickname} (${serverName})] ${out.status}\n${out.msg}`);
		return out;
	}

	const j = meta.json;
	if (Settings.successCodes.has(j.code)) {
		out.success = true;
		out.status = j.code === 0 ? "✅ Check-in Successful" : "👌 Already Checked In";
		out.msg = j.code === 0
			? (j?.data?.awardIds || []).map(a => {
				const id = a?.id ?? a;
				const r = j.data.resourceInfoMap?.[id];
				return r ? `🎁 ${r.name} x${r.count}` : String(id || "Unknown");
			}).join("\n") || "No detailed reward info."
			: "🎁 Successfully claimed";
	} else {
		out.status = `❌ Error (Code: ${j.code})`;
		out.msg = j.message || "Unknown Error";
	}

	console.log(`[${nickname} (${serverName})] ${out.status}\n${out.msg}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2) {
	rows = Array.isArray(rows) ? rows : [rows];
	const allSuccess = rows.every(r => r.success);

	const embed = {
		title: "📝 Endfield Daily Check-in Report",
		color: allSuccess ? 5763719 : 15548997,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields: rows.flatMap((r, i) => [
			{
				name: `👤 **${r.nickname} (${r.serverName})**`,
				value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${r.msg || "None"}`,
				inline: true
			},
			...((i + 1) % colCount === 0 && i + 1 < rows.length && colCount < 3
				? [{ name: "\u200B", value: "\u200B", inline: false }]
				: [])
		]),
		footer: { text: "Claimed on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
		timestamp: new Date().toISOString()
	};

	const reqs = discordApp
		.filter(d => d.notify && d.discordWebhook)
		.map(d => ({
			url: d.discordWebhook,
			method: "post",
			contentType: "application/json",
			muteHttpExceptions: true,
			payload: JSON.stringify({
				username: "Endfield Assistant",
				avatar_url: "https://pbs.twimg.com/profile_images/1984225639407529984/2_3-HRTS_400x400.jpg",
				content: !allSuccess && d.myDiscordID ? `<@${d.myDiscordID}> Script error!` : undefined,
				embeds: [embed]
			})
		}));

	if (reqs.length) chunkedFetchAll(reqs);
}

function telegramPost(rows) {
	rows = Array.isArray(rows) ? rows : [rows];
	const msg = rows.map(r =>
		`<b>👤 ${r.nickname} (${r.serverName})</b>\n<b>Status:</b>\n\u2003${r.status}\n<b>Response:</b>\n\u2003${r.msg || "None"}`
	).join("\n------------------\n");

	const reqs = telegramApp
		.filter(tg => tg.notify && tg.telegramBotToken)
		.map(tg => ({
			url: `https://api.telegram.org/bot${tg.telegramBotToken}/sendMessage`,
			method: "post",
			contentType: "application/json",
			muteHttpExceptions: true,
			payload: JSON.stringify({
				chat_id: tg.myTelegramID,
				text: msg,
				parse_mode: "HTML"
			})
		}));

	if (reqs.length) chunkedFetchAll(reqs);
}

function readMeta(r) {
	const raw = r?.getContentText?.() || "";
	return { resp: r, json: parseJson(raw), code: r?.getResponseCode?.() ?? null, rawText: raw };
}

function parseJson(s) {
	try { return JSON.parse(s); } catch (e) { return null; }
}

function nowTs() {
	return String(Math.floor(Date.now() / 1000));
}

function bytesToHex(bytes) {
	return bytes.map(b => ("0" + ((b & 0xFF).toString(16))).slice(-2)).join("");
}

function generateSign(path, body, timestamp, token, platform, vName) {
	const headerJson = JSON.stringify({
		platform: String(platform),
		timestamp: String(timestamp),
		dId: "",
		vName: String(vName)
	});
	const hmac = Utilities.computeHmacSha256Signature(path + (body || "") + timestamp + headerJson, token || "");
	return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytesToHex(hmac), Utilities.Charset.UTF_8));
}

function createDummyResponse() {
	return {
		getContentText: () => "",
		getResponseCode: () => 500
	};
}

function chunkedFetchAll(requests) {
	if (!requests?.length) return [];
	const out = [];
	for (let i = 0; i < requests.length; i += (Settings.chunkSize || 20)) {
		try {
			out.push(...UrlFetchApp.fetchAll(requests.slice(i, i + (Settings.chunkSize || 20))));
		} catch (e) {
			console.error("chunk fetchAll failed", e);
			out.push(...requests.slice(i, i + (Settings.chunkSize || 20)).map(() => createDummyResponse()));
		}
	}
	return out;
}

function failedIdx(arr) {
	return arr.map((m, i) => (!m?.json || (m.json.code !== 0 && m.json.code !== 10001) ? i : -1)).filter(i => i >= 0);
}

function buildPlayerBindingRequest(cred, signToken) {
	const ts = nowTs();
	return {
		url: Settings.endpoints.binding,
		method: "get",
		muteHttpExceptions: true,
		headers: {
			cred,
			platform: Settings.platform,
			vname: Settings.vName,
			timestamp: ts,
			"sk-language": "en",
			sign: generateSign("/api/v1/game/player/binding", "", ts, signToken, Settings.platform, Settings.vName)
		}
	};
}

function buildTokenRefresh(p) {
	return {
		url: Settings.endpoints.refresh,
		method: "get",
		muteHttpExceptions: true,
		headers: {
			"User-Agent": Settings.userAgent,
			Accept: Settings.defaultHeaders.accept,
			cred: p.cred || "",
			platform: Settings.platform || "",
			vName: Settings.vName || "",
			Origin: Settings.defaultHeaders.origin,
			Referer: Settings.defaultHeaders.referer
		}
	}
}

function buildAttendRequest(p, token, ts) {
	const body = JSON.stringify({ role: p.skGameRole });
	return {
		url: Settings.endpoints.attendance,
		method: "post",
		contentType: "application/json",
		payload: body,
		muteHttpExceptions: true,
		headers: Object.assign({}, Settings.baseAttHeaders, {
			"sk-game-role": p.skGameRole || "",
			cred: p.cred || "",
			platform: Settings.platform || "",
			vName: Settings.vName || "",
			timestamp: ts,
			sign: generateSign("/web/v1/game/endfield/attendance", body, ts, token || "", Settings.platform, Settings.vName)
		})
	};
}
