const profiles = [
	{ 
		cred: "xxxxxxxxxxxxxxxxxxxxxxxxxxx",
		skGameRole: "xxxxxxxxxxxxxxxxxxxxx",
		platform: "3",
		vName: "1.0.0",
		accountName: "Account - 1"
	}
];

const discordApp = [
	{
		notify: false,
		myDiscordID: 'xxxxxxxxxxxxxxxxxxxxxxxxxxx',
		discordWebhook: 'https://discord.com/api/webhooks/xxxxxxxxxxxxxxxxxxxxx/xxxxxxxxxxxxxxxxxxxxx'
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
	retry: { max: 3, initialBackoffMs: 1000 },
	endpoints: {
		refresh: 'https://zonai.skport.com/web/v1/auth/refresh',
		attendance: 'https://zonai.skport.com/web/v1/game/endfield/attendance'
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
	const payloads = profiles.map(p => ({ platform: p.platform, vName: p.vName, role: p.skGameRole }));
	const profilesSize = profiles.length;
	const refreshReqs = profiles.map(p => ({
		url: Settings.endpoints.refresh,
		method: 'get',
		muteHttpExceptions: true,
		headers: {
			'User-Agent': Settings.userAgent,
			Accept: Settings.defaultHeaders.accept,
			cred: p.cred || '',
			platform: p.platform || '',
			vName: p.vName || '',
			Origin: Settings.defaultHeaders.origin,
			Referer: Settings.defaultHeaders.referer
		}
	}));
	const refreshRes = chunkedFetchAll(refreshReqs, profilesSize);
	const tokens = refreshRes.map(r => {
		const j = safeParse(r.getContentText && r.getContentText());
		return j?.code === 0 && j?.data?.token ? j.data.token : '';
	});
	while (tokens.length < profilesSize) tokens.push('');
	const tsInit = String(Math.floor(Date.now() / 1000));
	const attendReqs = profiles.map((p, i) => buildAttendRequest(p, payloads[i], tokens[i] || '', tsInit));
	let rawResponses = chunkedFetchAll(attendReqs, profilesSize);
	const responsesWithMeta = rawResponses.map(r => {
		let txt = '';
		let j = null;
		let code = null;
		try {
			txt = r.getContentText ? r.getContentText() : '';
			j = safeParse(txt);
			code = r.getResponseCode ? r.getResponseCode() : null;
		} catch (e) {
			console.error('parse error in initial responsesWithMeta', e);
		}
		return { resp: r, json: j, code, rawText: txt };
	});
	const retryCfg = Settings.retry;
	if (retryCfg.max > 1) {
		let failedIdx = getFailedIdxFromMeta(responsesWithMeta);
		const failedIdxSize = failedIdx.length;
		for (let attempt = 1; failedIdxSize && attempt < retryCfg.max; attempt++) {
			Utilities.sleep(retryCfg.initialBackoffMs * Math.pow(2, attempt - 1));
			const ts = String(Math.floor(Date.now() / 1000));
			const batchReqs = failedIdx.map(i => buildAttendRequest(profiles[i], payloads[i], tokens[i] || '', ts));
			let batchRes = [];
			try {
				batchRes = chunkedFetchAll(batchReqs, failedIdxSize);
				batchRes.forEach((br, k) => {
					const idx = failedIdx[k];
					let txt = '', j = null, code = null;
					try {
						txt = br.getContentText ? br.getContentText() : '';
						j = safeParse(txt);
						code = br.getResponseCode ? br.getResponseCode() : null;
					} catch (e) {
						console.error('parse error in batchRes', e);
					}
					responsesWithMeta[idx] = { resp: br, json: j, code, rawText: txt };
				});
			} catch (e) {
				console.error('batch retry fetchAll failed', e);
				failedIdx.forEach(i => {
					responsesWithMeta[i] = { resp: createDummyResponse(), json: null, code: 500, rawText: '' };
				});
			}
			failedIdx = getFailedIdxFromMeta(responsesWithMeta);
		}
	}
	const results = profiles.map((p, i) => {
		const name = p.accountName || `#${i + 1}`;
		const meta = responsesWithMeta[i] || { resp: createDummyResponse(), json: null, rawText: '' };
		const out = { name, success: false, status: '', msg: '', payload: payloads[i], raw: (meta.rawText || '').slice(0, 2000) };
		if (!meta.json) {
			out.status = '💥 Invalid JSON / Fetch Failed';
			out.msg = meta.rawText || 'No response';
			console.log(`[${name}] ${out.status}\n${out.msg}`);
			return out;
		}
		const json = meta.json;
		if (Settings.successCodes.has(json.code)) {
			out.success = true;
			if (json.code === 0) {
				out.status = '✅ Check-in Successful';
				out.msg = (json?.data?.awardIds || []).map(a => {
					const id = a?.id ?? a;
					const r = json.data.resourceInfoMap?.[id];
					return r ? `🎁 ${r.name} x${r.count}` : String(id || 'Unknown');
				}).join('\n') || 'No detailed reward info.';
			} else {
				out.status = '👌 Already Checked In';
				out.msg = '🎁 Successfully claimed';
			}
		} else {
			out.status = `❌ Error (Code: ${json.code})`;
			out.msg = json.message || 'Unknown Error';
		}
		console.log(`[${name}] ${out.status}\n${out.msg}`);
		return out;
	});
	try { discordPost(results); } catch (e) { console.error('discordPost failed:', e); }
	try { telegramPost(results); } catch (e) { console.error('telegramPost failed:', e); }
	return results;
}

function discordPost(data, colCount = Settings.discordColumn) {
	const rows = Array.isArray(data) ? data : [data];
	const allSuccess = rows.every(r => r.success);
	const fields = rows.flatMap((r, i) => [
		{ name: `👤 ${r.name}`, value: `**Status:**\n${r.status}\n**Response:**\n${r.msg || 'None'}`, inline: true },
		...((i + 1) % colCount === 0 && (i + 1) < rows.length && colCount < 3 ? [{ name: '\u200B', value: '\u200B', inline: false }] : [])
	]);
	const embed = {
		title: "📝 Endfield Daily Check-in Report",
		color: allSuccess ? 5763719 : 15548997,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields,
		footer: { text: "Claimed on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
		timestamp: new Date().toISOString()
	};
	const requests = discordApp
		.filter(d => d.notify && d.discordWebhook)
		.map(d => ({
			url: d.discordWebhook,
			method: 'post',
			contentType: 'application/json',
			muteHttpExceptions: true,
			payload: JSON.stringify({
			username: "Endfield Assistant",
			avatar_url: "https://pbs.twimg.com/profile_images/1984225639407529984/2_3-HRTS_400x400.jpg",
			content: !allSuccess && d.myDiscordID ? `<@${d.myDiscordID}> Script error!` : undefined,
			embeds: [embed]
		})
	}));
	if (requests.length === 0) return;
	try {
		chunkedFetchAll(requests, requests.length);
	} catch (e) {
		console.error('Failed to send Discord webhook via chunkedFetchAll:', e);
	}
}

function telegramPost(data) {
	const rows = Array.isArray(data) ? data : [data];
	const message = rows.map(r => `<b>👤 ${r.name}</b>\n<b>Status:</b>\n${r.status}\n<b>Response:</b>\n${r.msg || 'None'}`).join('\n------------------\n');
	const requests = telegramApp
		.filter(tg => tg.notify)
		.map(tg => ({
			url: `https://api.telegram.org/bot${tg.telegramBotToken}/sendMessage`,
			method: 'post',
			contentType: 'application/json',
			payload: JSON.stringify({ 
			chat_id: tg.myTelegramID, 
			text: message, 
			parse_mode: 'HTML' 
		}),
		muteHttpExceptions: true
	}));
	if (requests.length === 0) return;
	try {
		chunkedFetchAll(requests, requests.length);
	} catch (e) {
		console.error('Failed to send Telegram messages via chunkedFetchAll:', e);
	}
}

function safeParse(s) {
	try { return JSON.parse(s); } catch (e) { return null; }
}

function bytesToHex(bytes) {
	return bytes.map(b => ('0' + ((b & 0xFF).toString(16))).slice(-2)).join('');
}

function generateSign(path, body, timestamp, token, platform, vName) {
	const headerJson = JSON.stringify({ platform: String(platform), timestamp: String(timestamp), dId: "", vName: String(vName) });
	const str = path + (body || '') + timestamp + headerJson;
	const hmac = Utilities.computeHmacSha256Signature(str, token || '');
	const hmacHex = bytesToHex(hmac);
	const md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex);
	return bytesToHex(md5);
}

function createDummyResponse() {
	return {
		getContentText: () => '',
		getResponseCode: () => 500
	};
}

function chunkedFetchAll(requests, chunkSize = Settings.chunkSize) {
	chunkSize = Math.min(chunkSize, Settings.chunkSize)
	const out = [];
	for (let i = 0; i < requests.length; i += chunkSize) {
		const chunk = requests.slice(i, i + chunkSize);
		try {
			const res = UrlFetchApp.fetchAll(chunk);
			out.push(...res);
		} catch (e) {
			console.error('chunk fetchAll failed', e);
			out.push(...chunk.map(() => createDummyResponse()));
		}
	}
	return out;
}

function isFailedResponse(meta) {
	try {
		const { json, code } = meta;
		if (!json) return true;
		if (Settings.successCodes.has(json.code)) return false;
		if (code && code >= 500) return true;
		return true;
	} catch (e) {
		return true;
	}
}

function getFailedIdxFromMeta(metaArr) {
	return metaArr.map((m, i) => isFailedResponse(m) ? i : -1).filter(i => i >= 0);
}

function buildAttendRequest(p, payload, token, ts) {
	const bodyStr = JSON.stringify(payload);
	const sign = generateSign('/web/v1/game/endfield/attendance', bodyStr, ts, token || '', p.platform, p.vName);
	const headers = Object.assign({}, Settings.baseAttHeaders, {
		'sk-game-role': p.skGameRole || '',
		cred: p.cred || '',
		platform: p.platform || '',
		vName: p.vName || '',
		timestamp: ts,
		sign
	});
	return {
		url: Settings.endpoints.attendance,
		method: 'post',
		contentType: 'application/json',
		payload: bodyStr,
		muteHttpExceptions: true,
		headers
	};
}
