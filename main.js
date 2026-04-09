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
		attendance: "https://zonai.skport.com/web/v1/game/endfield/attendance",
		card: "https://zonai.skport.com/api/v1/game/endfield/card/detail"
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
			? { ...p, token, skGameRole: p.skGameRole || "", nickname: p.accountName || "", serverName: p.serverName || "", playerCard: {}}
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

	const cardIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (cardIdx.length) {
		chunkedFetchAll(
			cardIdx.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token))
		).forEach((r, k) => resolved[cardIdx[k]].card = readMeta(r));
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.card))
			.filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			Utilities.sleep(backoff << a);
			chunkedFetchAll(
				f.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token))
			).forEach((r, k) => resolved[f[k]].card = readMeta(r));
		}

	cardIdx.forEach(i => {
		const j = resolved[i].card?.json?.data?.detail;
		resolved[i].playerCard = {
			stamina: `⚡️ EN: ${j.dungeon.curStamina}/${j.dungeon.maxStamina}`,
			battlepass: `🗡️ BP: ${j.bpSystem.curLevel}/${j.bpSystem.maxLevel}`,
			daily: `🔄 Daily: ${j.dailyMission.dailyActivation}/${j.dailyMission.maxDailyActivation}`,
			weekly: `🔁 Weekly: ${j.weeklyMission.score}/${j.weeklyMission.total}`
			};
		});
	}

	const reqIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (reqIdx.length) {
		chunkedFetchAll(
			reqIdx.map(i => buildAttendRequest(resolved[i], resolved[i].token))
		).map(readMeta)
		 .forEach((m, k) => resolved[reqIdx[k]].meta = m);
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.meta)).filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			Utilities.sleep(backoff << a);
			chunkedFetchAll(
				f.map(i => buildAttendRequest(resolved[i], resolved[i].token))
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
	const out = { nickname, serverName, success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000), itemIcon_url: [] };

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
        out.itemIcon_url.push(r.icon);
				return r ? `🎁 ${r.name} x${r.count}` : String(id || "Unknown");
			}).join("\n") || "No detailed reward info."
			: "🎁 Successfully claimed";
      out.msg += `\n${p.playerCard.stamina}\n${p.playerCard.battlepass}\n${p.playerCard.daily}\n${p.playerCard.weekly}`;
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
	const nl = s => s.replace(/\r?\n/g, '\n\u2003'); 

  //for combine image api and discord webhook image: {url: ""}
  //const iconUrls = [...new Set(rows.flatMap(r => r.itemIcon_url).filter(Boolean))];

	const embed = {
		title: "📝 Endfield Daily Check-in Report",
		color: allSuccess ? 5763719 : 15548997,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields: rows.flatMap((r, i) => [
			{
				name: `👤 **${r.nickname} (${r.serverName})**`,
				value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${nl(r.msg) || "None"}`,
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

	if (!reqs.length) return;

	const { max: maxRetry = 1, initialBackoffMs: backoff = 500 } = Settings.retry || {};
	let pending = reqs.map((req, i) => ({ req, index: i }));
	const results = new Array(reqs.length);
	for (let a = 0; a <= maxRetry && pending.length; a++) {
		const responses = chunkedFetchAll(pending.map(p => p.req));
		const next = [];
		responses.forEach((res, i) => {
			const code = res.getResponseCode();
			const idx = pending[i].index;
			(code === 204 || code === 200)
				? results[idx] = res
				: (a < maxRetry && (code === 429 || code >= 500))
					? next.push(pending[i])
					: results[idx] = res;
		});

		if (next.length) {
			const delay = backoff << a;
			console.warn(`discordPost Retry ${a + 1} (${next.length}) in ${delay} ms`);
			Utilities.sleep(delay);
		}
		pending = next;
	}
	/*results.forEach((res, i) => {
		const code = res.getResponseCode();
		const ok = code >= 200 && code < 300;
		console[ok ? "log" : "error"](ok ? `Webhook ${i} -> success` : `Webhook ${i} -> failed (${code})`);
		if (!ok) console.error(res.getContentText());
	});*/
}

function telegramPost(rows) {
	rows = Array.isArray(rows) ? rows : [rows];
	const nl = s => s.replace(/\r?\n/g, '\n\u2003');
	const msg = rows.map(r =>
		`<b>👤 ${r.nickname} (${r.serverName})</b>\n<b>Status:</b>\n\u2003${r.status}\n<b>Response:</b>\n\u2003${nl(r.msg) || "None"}`
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

	if (!reqs.length) return;

	const { max: maxRetry = 1, initialBackoffMs: backoff = 500 } = Settings.retry || {};
	let pending = reqs.map((req, i) => ({ req, index: i }));
	const results = new Array(reqs.length);
	for (let a = 0; a <= maxRetry && pending.length; a++) {
		const responses = chunkedFetchAll(pending.map(p => p.req));
		const next = [];
		responses.forEach((res, i) => {
			const code = res.getResponseCode();
			const idx = pending[i].index;
			let ok = code === 200 && (() => {
				try { return JSON.parse(res.getContentText())?.ok === true; } catch { return false; }
			})();
			if (ok) results[idx] = res;
			else (a < maxRetry && (code === 429 || code >= 500))
				? next.push(pending[i])
				: results[idx] = res;
		});
		if (next.length) {
			const delay = backoff << a;
			console.warn(`telegramPost Retry ${a + 1} (${next.length}) in ${delay} ms`);
			Utilities.sleep(delay);
		}
		pending = next;
	}
	/*results.forEach((res, i) => {
		const code = res.getResponseCode();
		let ok = false;
		try { ok = code === 200 && JSON.parse(res.getContentText())?.ok === true; } catch {}
		console[ok ? "log" : "error"](ok ? `Telegram ${i} -> success` : `Telegram ${i} -> failed (${code})`);
		if (!ok) console.error(res.getContentText());
	});*/
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

function chunkedFetchAll(requests) {
	if (!requests?.length) return [];
	const out = [];
	const size = Settings.chunkSize || 20;
	for (let i = 0; i < requests.length; i += size) {
		const chunk = requests.slice(i, i + size);
		try {
			out.push(...UrlFetchApp.fetchAll(chunk));
		} catch (e) {
			console.error("chunk fetchAll failed", e);
			out.push(...chunk.map(() => ({
				getContentText: () => "",
				getResponseCode: () => 500
			})));
		}
	}
	return out;
}

function failedIdx(arr) {
	return arr.map((m, i) => (!m?.json || (m.json.code !== 0 && m.json.code !== 10001) ? i : -1)).filter(i => i >= 0);
}

const buildHttpRequest = (url, method, headers, payload) => ({
	url,
	method,
	muteHttpExceptions: true,
	...(payload && { contentType: "application/json", payload }),
	headers
});

function buildTokenRefresh(p) {
	return buildHttpRequest(Settings.endpoints.refresh, "get", {
		"User-Agent": Settings.userAgent,
		Accept: Settings.defaultHeaders.accept,
		Origin: Settings.defaultHeaders.origin,
		Referer: Settings.defaultHeaders.referer,
		cred: p.cred || "",
		platform: Settings.platform || "",
		vName: Settings.vName || ""
	});
}

function buildPlayerBindingRequest(cred, token) {
	const ts = nowTs();
	return buildHttpRequest(Settings.endpoints.binding, "get", {
		cred,
		platform: Settings.platform,
		vName: Settings.vName,
		timestamp: ts,
		"sk-language": "en",
		sign: generateSign("/api/v1/game/player/binding", "", ts, token || "", Settings.platform, Settings.vName)
	});
}

function buildCardRequest(cred, token) {
	const ts = nowTs();
	return buildHttpRequest(Settings.endpoints.card, "get", {
		cred,
		platform: Settings.platform,
		vName: Settings.vName,
		timestamp: ts,
		"sk-language": "en",
		sign: generateSign("/api/v1/game/endfield/card/detail", "", ts, token || "", Settings.platform, Settings.vName)
	});
}

function buildAttendRequest(p, token) {
	const body = JSON.stringify({ role: p.skGameRole });
	const ts = nowTs();
	return buildHttpRequest(Settings.endpoints.attendance, "post", {
		...Settings.baseAttHeaders,
		cred: p.cred || "",
		platform: Settings.platform || "",
		vName: Settings.vName || "",
		timestamp: ts,
		"sk-game-role": p.skGameRole || "",
		sign: generateSign("/web/v1/game/endfield/attendance", body, ts, token || "", Settings.platform, Settings.vName)
	}, body);
}
