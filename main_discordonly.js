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

const Settings = {
	platform: "3",
	vName: "1.0.0",
	appCode: "endfield",
	userTimezone: "UTC+7", //Bangkok (TH) 
	serverTimezone: "UTC+8", //Asia Server
	reward_db: "reward_db",
	discord_db: "discord_db",
	discordColumn: 2,
	discordUseEdit: true,
	discordDailyPost: true,
	retry: { max: 15, initialBackoffMs: 500, maxBackoffMs: 10000 },
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
	successCodes: new Set([0, 10001])
};

function main() {
	if (!profiles.length) return [];
	const { max: maxRetry = 1, initialBackoffMs: backoff = 500 } = Settings.retry || {};

	let tokens = chunkedFetchAll(profiles.map(buildTokenRefresh)).map(r => ((m = readMeta(r)) => m?.code === 10002 ? "" : (m?.json?.data?.token ?? null))());
	for (let a = 1, f; (f = tokens.map((t, i) => t === null ? i : -1).filter(i => i !== -1)).length && a < maxRetry; a++) {
		setDelay(`refreshToken`, backoff << (a - 1));
		chunkedFetchAll(f.map(i => buildTokenRefresh(profiles[i])))
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
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.bind)).filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			setDelay(`playerBinding`, backoff << (a - 1));
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
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.card)).filter(i => resolved[i].token !== "" && resolved[i].token !== null)).length && a < maxRetry; a++) {
			setDelay(`playerCard`, backoff << (a - 1));
			chunkedFetchAll(
				f.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token))
			).forEach((r, k) => resolved[f[k]].card = readMeta(r));
		}

		const timeAgo = ts => {
		  const diff = ((ts > 1e11 ? ts / 1e3 : ts) - Date.now() / 1e3) | 0, a = Math.abs(diff), f = (n, u) => diff > 0 ? `in ${n} ${u}${n > 1 ? "s" : ""}` : `${n} ${u}${n > 1 ? "s" : "" } ago`;
		  return a < 60 ? f(a, "second") : a < 3600 ? f(Math.round(a / 60), "minute") : a < 86400 ? f(Math.round(a / 3600), "hour") : f(Math.round(a / 86400).toLocaleString(), "day");
		};

		cardIdx.forEach(i => {
			const j = resolved[i].card?.json?.data?.detail;
			const softCap = 240, isMaxed = +j.dungeon.curStamina >= +j.dungeon.maxStamina, isBelowCap = +j.dungeon.curStamina < softCap;
			const getRegenTime = (cur, cap, regenMs = 432000) => Math.floor(cur >= cap ? Date.now() : (Math.ceil(Date.now() / regenMs) * regenMs + (cap - cur - 1) * regenMs) / 1000);
			j.dungeon.maxTs = isBelowCap ? getRegenTime(j.dungeon.curStamina, softCap) : getRegenTime(j.dungeon.curStamina, j.dungeon.maxStamina);
			resolved[i].playerCard = {
				loginTs: `🔑 Login: <t:${j.base.lastLoginTime}:R>`,
				loginTime: `🔑 Login: ${timeAgo(j.base.lastLoginTime)}`,
				sanity: `⚡️ Energy: ${j.dungeon.curStamina}/${j.dungeon.maxStamina}`,
				maxSanityTs: `\u2003 → ${isBelowCap ? softCap : `Full`} in: ${isMaxed ? `Fulled` : `<t:${j.dungeon.maxTs}:R>`}`,
				maxSanityTime: `\u2003 → ${isBelowCap ? softCap : `Full`} in: ${isMaxed ? `Fulled` : timeAgo(j.dungeon.maxTs)}`,
				battlePass: `🗡️ BP: ${j.bpSystem.curLevel}/${j.bpSystem.maxLevel}`,
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
			setDelay(`rewardClaim`, backoff << (a - 1));
			chunkedFetchAll(
				f.map(i => buildAttendRequest(resolved[i], resolved[i].token))
			).map(readMeta)
			 .forEach((m, k) => resolved[f[k]].meta = m);
		}
	}

	const results = resolved.map((p, i) => formatResult(p, p.meta, i));
	discordPost(results);
	return results;
}

function formatResult(p, meta, i) {
	const store = PropertiesService.getScriptProperties(), nickname = p.nickname || `#${i + 1}`, serverName = p.serverName || "", acc = p.skGameRole || `#${i + 1}`;
	const d = Utilities.formatDate(new Date(), Settings.serverTimezone, "yyyy-MM-dd"), key = Settings.reward_db;

	let db = JSON.parse(store.getProperty(key) || '{"date":"","items":{},"accounts":{}}');
	if (db.date !== d) store.setProperty(key, JSON.stringify(db = { date: d, items: {}, accounts: {} }));

	const out = { nickname, serverName, success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000), itemIcon_url: [], playerCard: p?.playerCard ?? {} };
	if (!meta?.json) return out.status = "💥 Invalid JSON", out.msg = meta?.rawText || "No response", out;

	const j = meta.json;
	if (Settings.successCodes.has(j.code)) {
		out.success = true, out.status = j.code === 0 ? "✅ Check-in Successful" : "👌 Already Checked In";
		if (j.code === 0) {
			const ids = [...new Set((j?.data?.awardIds || []).map(a => {
				const id = String(a?.id ?? a), r = j.data.resourceInfoMap?.[id];
				return r && (db.items[id] = [`🎁 ${r.name} x${r.count}`, r.icon || ""]), id;
			}))];
			db.accounts[acc] = ids, store.setProperty(key, JSON.stringify(db));
			out.msg = ids.map(id => db.items[id]?.[0] || `ID: ${id}`).join("\n"), out.itemIcon_url = ids.map(id => db.items[id]?.[1]).filter(Boolean);
		} else {
			const ids = db.accounts[acc] || [];
			out.msg = ids.length ? ids.map(id => db.items[id]?.[0]).join("\n") : "🎁 Successfully claimed", out.itemIcon_url = ids.map(id => db.items[id]?.[1]).filter(Boolean);
		}
	} else out.status = `❌ Error (Code: ${j.code})`, out.msg = j.message || "Unknown Error";

	console.log(`Server Time: ${Utilities.formatDate(new Date(), Settings.serverTimezone, "HH:mm:ss")}\n[${nickname} (${serverName})]\n${out.status}\n${out.msg}${typeof buildPlayerCard !== 'undefined' ? buildPlayerCard(out) : ""}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2, useEdit = Settings.discordUseEdit || false, dailyPost = Settings.discordDailyPost || false) {
	rows = Array.isArray(rows) ? rows : [rows];
	const store = PropertiesService.getScriptProperties(), key = Settings.discord_db, hooks = discordApp.filter(d => d.notify && d.discordWebhook), k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	const d = Utilities.formatDate(new Date(), Settings.serverTimezone, "yyyy-MM-dd");
	
	let db = JSON.parse(store.getProperty(key) || '{"date":"","msgMap":{}}');
	if (!useEdit || (dailyPost && db.date !== d)) store.setProperty(key, JSON.stringify(db = { date: d, msgMap: {} }));

	const allSuccess = rows.every(r => r.success), nl = s => s.replace(/\r?\n/g, '\n\u2003'), embed = {
		title: "📝 Endfield - Report",
		color: allSuccess ? 5763719 : 15548997,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields: rows.flatMap((r, i) => [{
			name: `👤 **${r.nickname} (${r.serverName})**`,
			value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${nl(r.msg + (typeof buildPlayerCard !== 'undefined' ? buildPlayerCard(r, true) : "")) || "None"}`,
			inline: true
		}, ...((i + 1) % colCount === 0 && i + 1 < rows.length && colCount < 3 ? [{ name: "\u200B", value: "\u200B", inline: false }] : [])]),
		footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
		timestamp: new Date().toISOString()
	};

	const reqs = hooks.map(d => {
		const h = k(d.discordWebhook), id = db.msgMap[h];
		return {
			url: useEdit && id ? `${d.discordWebhook}/messages/${id}` : d.discordWebhook + "?wait=true",
			method: useEdit && id ? "patch" : "post",
			contentType: "application/json", muteHttpExceptions: true,
			payload: JSON.stringify({
				username: "Endfield Assistant",
				avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png",
				content: !allSuccess && d.myDiscordID ? `<@${d.myDiscordID}> Script error!` : undefined,
				embeds: [embed]
			})
		};
	});

	if (!reqs.length) return;
	const { max: maxRetry = 1, initialBackoffMs: backoff = 500 } = Settings.retry || {};
	let pending = reqs.map((req, i) => ({ req, hook: hooks[i].discordWebhook, key: k(hooks[i].discordWebhook) }));
	
	for (let a = 0; a <= maxRetry && pending.length; a++) {
		const responses = chunkedFetchAll(pending.map(p => p.req)), next = [];
		responses.forEach((res, i) => {
			const code = res.getResponseCode(), { hook, key: h } = pending[i];
			if (code === 204 || code === 200) {
				if (useEdit && code === 200) try { db.msgMap[h] = JSON.parse(res.getContentText()).id } catch(e) {}
			} else if (useEdit && code === 404) {
				delete db.msgMap[h];
				pending[i].req.method = "post"; pending[i].req.url = hook + "?wait=true";
				next.push(pending[i]);
			} else if (a < maxRetry && (code === 429 || code >= 500)) next.push(pending[i]);
		});
		if (next.length) setDelay(`discordPost`, backoff << a);
		pending = next;
	}
	useEdit && store.setProperty(key, JSON.stringify(db));
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

const setDelay = (str, delay) => (delay = Math.min(delay, Settings.retry?.maxBackoffMs ?? delay), console.warn(`${str} Retry in ${delay} ms`), Utilities.sleep(delay));

const buildPlayerCard = (p, b = false) => p?.playerCard ? `\n${b ? p.playerCard.loginTs : p.playerCard.loginTime}\n${p.playerCard.sanity}\n${b ? p.playerCard.maxSanityTs : p.playerCard.maxSanityTime}\n${p.playerCard.battlePass}\n${p.playerCard.daily}\n${p.playerCard.weekly}`: "";

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
