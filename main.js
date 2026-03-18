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
	retry: { max: 3, initialBackoffMs: 1000 },
	endpoints: {
    refresh: "https://zonai.skport.com/web/v1/auth/refresh",
  	binding: "https://zonai.skport.com/api/v1/game/player/binding",
  	attendance: "https://zonai.skport.com/web/v1/game/endfield/attendance"
	},
	userAgent: 'Mozilla/5.0',
	defaultHeaders: {
		accept: 'application/json, text/plain, */*',
		origin: 'https://game.skport.com',
		referer: 'https://game.skport.com/'
	},
	baseAttHeaders: {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
		'Accept': '*/*',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br, zstd',
		'Referer': 'https://game.skport.com/',
		'Content-Type': 'application/json',
		'sk-language': 'en',
		'Origin': 'https://game.skport.com',
		'Connection': 'keep-alive',
		'Sec-Fetch-Dest': 'empty',
		'Sec-Fetch-Mode': 'cors',
		'Sec-Fetch-Site': 'same-site'
	},
	chunkSize: 20,
	discordColumn: 2,
	successCodes: new Set([0, 10001])
};

function main() {
	if (!profiles?.length) return [];

	const refreshReqs = profiles.map(p => ({
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
	}));

	const tokens = chunkedFetchAll(refreshReqs).map(r => safeParse(r?.getContentText?.())?.data?.token || "");

	const resolvedProfiles = profiles.map((p, i) => {
		const b = getPlayerBinding(p.cred || "", tokens[i] || "");
		return {
			...p,
			skGameRole: b?.skGameRole || p.skGameRole || "",
			nickname: b?.nickname || p.nickname || "",
			serverName: b?.serverName || p.serverName || "",
			level: b?.level ?? p.level ?? 0,
			gameId: b?.gameId ?? p.gameId ?? ""
		};
	});

	const payloads = resolvedProfiles.map(p => ({ role: p.skGameRole }));
	let metas = chunkedFetchAll(resolvedProfiles.map((p, i) => buildAttendRequest(p, payloads[i], tokens[i] || "", nowTs()))).map(readMeta);

	for (let attempt = 1, failed = getFailedIdxFromMeta(metas); failed.length && attempt < (Settings.retry?.max || 1); attempt++, failed = getFailedIdxFromMeta(metas)) {
		Utilities.sleep((Settings.retry?.initialBackoffMs || 1000) * Math.pow(2, attempt - 1));
		const ts = nowTs();
		const reqs = failed.map(i => buildAttendRequest(resolvedProfiles[i], payloads[i], tokens[i] || "", ts));
		chunkedFetchAll(reqs).forEach((r, k) => metas[failed[k]] = readMeta(r));
	}

	const results = resolvedProfiles.map((p, i) => formatResult(p, payloads[i], metas[i], i));
	discordPost(results);
	telegramPost(results);
	return results;
}

function formatResult(p, payload, meta, i) {
	const nickname = p.nickname || `#${i + 1}`;
	const serverName = p.serverName || "";
	const out = {
		nickname,
		serverName,
		success: false,
		status: "",
		msg: "",
		payload,
		raw: (meta?.rawText || "").slice(0, 2000)
	};

	if (!meta?.json) {
		out.status = "💥 Invalid JSON / Fetch Failed";
		out.msg = meta?.rawText || "No response";
		console.log(`[${nickname} (${serverName})] ${out.status}\n${out.msg}`);
		return out;
	}

	const json = meta.json;

	if (Settings.successCodes.has(json.code)) {
		out.success = true;
		out.status = json.code === 0 ? "✅ Check-in Successful" : "👌 Already Checked In";
		out.msg = json.code === 0
			? (json?.data?.awardIds || []).map(a => {
				const id = a?.id ?? a;
				const r = json.data.resourceInfoMap?.[id];
				return r ? `🎁 ${r.nickname} x${r.count}` : String(id || "Unknown");
			}).join("\n") || "No detailed reward info."
			: "🎁 Successfully claimed";
	} else {
		out.status = `❌ Error (Code: ${json.code})`;
		out.msg = json.message || "Unknown Error";
	}

	console.log(`[${nickname} (${serverName})] ${out.status}\n${out.msg}`);
	return out;
}

function discordPost(data, colCount = Settings.discordColumn || 2) {
	const rows = Array.isArray(data) ? data : [data];
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
			...((i + 1) % colCount === 0 && i + 1 < rows.length && colCount < 3 ? [{ name: "\u200B", value: "\u200B", inline: false }] : [])
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

function telegramPost(data) {
	const rows = Array.isArray(data) ? data : [data];
	const msg = rows.map(r => `<b>👤 ${r.nickname} (${r.serverName})</b>\n<b>Status:</b>\n\u2003${r.status}\n<b>Response:</b>\n\u2003${r.msg || "None"}`).join("\n------------------\n");

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

function getPlayerBinding(cred, signToken) {
	try {
		const ts = String(Math.floor(Date.now() / 1000));
		const path = "/api/v1/game/player/binding";

		const res = UrlFetchApp.fetch(Settings.endpoints.binding, {
			method: "get",
			muteHttpExceptions: true,
			headers: {
				cred: cred,
				platform: Settings.platform,
				vname: Settings.vName,
				timestamp: ts,
				"sk-language": "en",
				sign: generateSign(path, "", ts, signToken, Settings.platform, Settings.vName)
			}
		});

		const json = safeParse(res?.getContentText?.());
		const app = json?.code === 0
			? json?.data?.list?.find(a => a.appCode === Settings.appCode && a.bindingList?.length)
			: null;

		const binding = app?.bindingList?.[0];
		const role = binding?.defaultRole || binding?.roles?.[0];

		return role?.roleId && role?.serverId
			? {
				skGameRole: `${binding.gameId}_${role.roleId}_${role.serverId}`,
				gameId: binding.gameId ?? "",
				nickname: role.nickname ?? "",
				serverName: role.serverName ?? "",
				level: role.level ?? 0
			}
			: null;

	} catch (e) {
		console.error("getPlayerBinding failed:", e);
		return null;
	}
}

function readMeta(r) {
	const raw = r?.getContentText?.() || "";
	return {
		resp: r,
		json: safeParse(raw),
		code: r?.getResponseCode?.() ?? null,
		rawText: raw
	};
}

function nowTs() {
	return String(Math.floor(Date.now() / 1000));
}

function safeParse(s) {
	try {
		return JSON.parse(s);
	} catch (e) {
		return null;
	}
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
	const str = path + (body || "") + timestamp + headerJson;
	const hmac = Utilities.computeHmacSha256Signature(str, token || "");
	const hmacHex = bytesToHex(hmac);
	const md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex, Utilities.Charset.UTF_8);
	return bytesToHex(md5);
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
		const chunk = requests.slice(i, i + (Settings.chunkSize || 20));
		try {
			out.push(...UrlFetchApp.fetchAll(chunk));
		} catch (e) {
			console.error("chunk fetchAll failed", e);
			out.push(...chunk.map(() => createDummyResponse()));
		}
	}
	return out;
}

function isFailedResponse(meta) {
	try {
		if (!meta?.json) return true;
		if (Settings.successCodes.has(meta.json.code)) return false;
		return !meta.code || meta.code >= 500;
	} catch (e) {
		return true;
	}
}

function getFailedIdxFromMeta(metaArr) {
	return metaArr.map((m, i) => isFailedResponse(m) ? i : -1).filter(i => i >= 0);
}

function buildAttendRequest(p, payload, token, ts) {
	const bodyStr = JSON.stringify(payload);
	const sign = generateSign("/web/v1/game/endfield/attendance", bodyStr, ts, token || "", Settings.platform, Settings.vName);
	return {
		url: Settings.endpoints.attendance,
		method: "post",
		contentType: "application/json",
		payload: bodyStr,
		muteHttpExceptions: true,
		headers: Object.assign({}, Settings.baseAttHeaders, {
			"sk-game-role": p.skGameRole || "",
			cred: p.cred || "",
			platform: Settings.platform || "",
			vName: Settings.vName || "",
			timestamp: ts,
			sign
		})
	};
}
