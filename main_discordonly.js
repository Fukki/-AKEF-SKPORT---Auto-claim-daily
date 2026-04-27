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
	userTimezone: Session.getScriptTimeZone(),
	serverTimezone: "Asia/Singapore", //Asia/Singapore (UTC+8) / America/New_York (UTC-5)
	serverResetTime: "04:00:00",
	serverResetWeekly: 1, //Monday
	serverResetArsenal: 5, //Friday
	serverBPStartDate: "2026-04-17",
	serverBPCycle: 35, //every 35 days
	reward_db: "reward_db",
	discord_db: "discord_db",
	discordColumn: 2,
	discordUseEdit: true,
	discordDailyPost: true,
	retry: { max: 15, initialBackoffMs: 500, maxBackoffMs: 5000 },
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
		"Content-Type": "application/json",
		"sk-language": "en",
		Origin: "https://game.skport.com",
		Connection: "keep-alive"
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
		chunkedFetchAll(f.map(i => buildTokenRefresh(profiles[i]))).forEach((r, k) => tokens[f[k]] = ((m = readMeta(r)) => m?.code === 10002 ? "" : (m?.json?.data?.token ?? null))());
	}

	const resolved = profiles.map((p, i) => (tokens[i] === "" || tokens[i] === null)
		? { ...p, token: tokens[i], skGameRole: p.skGameRole || "", nickname: p.accountName || "", serverName: p.serverName || "", playerCard: {} }
		: { ...p, token: tokens[i] });

	const bindIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (bindIdx.length) {
		chunkedFetchAll(bindIdx.map(i => buildPlayerBindingRequest(resolved[i].cred || "", resolved[i].token))).forEach((r, k) => resolved[bindIdx[k]].bind = readMeta(r));
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.bind)).filter(i => resolved[i].token)).length && a < maxRetry; a++) {
			setDelay(`playerBinding`, backoff << (a - 1));
			chunkedFetchAll(f.map(i => buildPlayerBindingRequest(resolved[i].cred || "", resolved[i].token))).forEach((r, k) => resolved[f[k]].bind = readMeta(r));
		}
		bindIdx.forEach(i => {
			const bList = resolved[i].bind?.json?.data?.list?.find(a => a.appCode === Settings.appCode)?.bindingList?.[0];
			const role = bList?.defaultRole || bList?.roles?.[0];
			if (role) {
				resolved[i].skGameRole = `${bList.gameId}_${role.roleId}_${role.serverId}`;
				resolved[i].nickname = role.nickname;
				resolved[i].serverName = role.serverName;
			}
		});
	}

	const cardIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (cardIdx.length) {
		chunkedFetchAll(cardIdx.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token))).forEach((r, k) => resolved[cardIdx[k]].card = readMeta(r));
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.card)).filter(i => resolved[i].token)).length && a < maxRetry; a++) {
			setDelay(`playerCard`, backoff << (a - 1));
			chunkedFetchAll(f.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token))).forEach((r, k) => resolved[f[k]].card = readMeta(r));
		}
		const timeAgo = ts => {
			const diff = ((ts > 1e11 ? ts / 1e3 : ts) - Date.now() / 1e3) | 0, a = Math.abs(diff), f = (n, u) => diff > 0 ? `in ${n} ${u}${n > 1 ? "s" : ""}` : `${n} ${u}${n > 1 ? "s" : "" } ago`;
			return a < 60 ? f(a, "second") : a < 3600 ? f(Math.round(a / 60), "minute") : a < 86400 ? f(Math.round(a / 3600), "hour") : f(Math.round(a / 86400).toLocaleString(), "day");
		};
		const getRegen = (cur, cap, ms = 432000) => Math.floor(cur >= cap ? Date.now() : (Math.ceil(Date.now() / ms) * ms + (cap - cur - 1) * ms) / 1000);
		cardIdx.forEach(i => {
			const d = resolved[i].card?.json?.data?.detail;
			if (!d) return;
			const { dungeon: dg, base: bs, bpSystem: bp, dailyMission: dm, weeklyMission: wm } = d;
			const cur = +dg.curStamina, max = +dg.maxStamina, cap = 240;
			resolved[i].playerCard = {
				loginTs: `🔑 Login: <t:${bs.lastLoginTime}:R>`, loginTime: `🔑 Login: ${timeAgo(bs.lastLoginTime)}`,
				sanity: `⚡️ Energy: ${cur}/${max}`,
				maxSanityTs: `\u2003 → ${cap}: ${cur < cap ? `<t:${getRegen(cur, cap)}:R>` : `\`Fulled\``}\n\u2003 → ${max}: ${cur >= max ? `\`Fulled\`` : `<t:${getRegen(cur, max)}:R>`}`,
				maxSanityTime: `\u2003 → ${cap}: ${cur < cap ? timeAgo(getRegen(cur, cap)) : `Fulled`}\n\u2003 → ${max}: ${cur >= max ? `Fulled` : timeAgo(getRegen(cur, max))}`,
				battlePass: `🌟 BP: ${bp.curLevel}/${bp.maxLevel}`, daily: `🌸 Daily: ${dm.dailyActivation}/${dm.maxDailyActivation}`, weekly: `📅 Weekly: ${wm.score}/${wm.total}`
			};
		});
	}

	const reqIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (reqIdx.length) {
		chunkedFetchAll(reqIdx.map(i => buildAttendRequest(resolved[i], resolved[i].token))).forEach((r, k) => resolved[reqIdx[k]].meta = readMeta(r));
		for (let a = 1, f; (f = failedIdx(resolved.map(p => p.meta)).filter(i => resolved[i].token)).length && a < maxRetry; a++) {
			setDelay(`rewardClaim`, backoff << (a - 1));
			chunkedFetchAll(f.map(i => buildAttendRequest(resolved[i], resolved[i].token))).forEach((r, k) => resolved[f[k]].meta = readMeta(r));
		}
	}

	const results = resolved.map((p, i) => formatResult(p, p.meta, i));
	discordPost(results);
	return results;
}

function formatResult(p, meta, i) {
	const store = PropertiesService.getScriptProperties(), key = Settings.reward_db, d = tzDate();
	let db = JSON.parse(store.getProperty(key) || '{"date":"","items":{},"accounts":{}}');
	if (db.date !== d) store.setProperty(key, JSON.stringify(db = { date: d, items: {}, accounts: {} }));

	const out = { nickname: p.nickname || `#${i + 1}`, serverName: p.serverName || "", success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000), itemIcon_url: [], playerCard: p?.playerCard ?? {} };
	if (!meta?.json) return (out.status = "💥 Invalid JSON", out.msg = meta?.rawText || "No response", out);

	const j = meta.json, acc = p.skGameRole || `#${i + 1}`;
	if (Settings.successCodes.has(j.code)) {
		out.success = true;
		out.status = j.code === 0 ? "✅ Check-in Successful" : "✅ Already Checked In";
		const ids = j.code === 0 ? [...new Set((j.data?.awardIds || []).map(a => {
			const id = String(a?.id ?? a), r = j.data.resourceInfoMap?.[id];
			if (r) db.items[id] = [`🎁 ${r.name} x${r.count}`, r.icon || ""];
			return id;
		}))] : (db.accounts[acc] || []);
		if (j.code === 0) { db.accounts[acc] = ids; store.setProperty(key, JSON.stringify(db)); }
		out.msg = ids.length ? ids.map(id => db.items[id]?.[0]).join("\n") : "🎁 Successfully claimed";
		out.itemIcon_url = ids.map(id => db.items[id]?.[1]).filter(Boolean);
	} else (out.status = `❌ Error (Code: ${j.code})`, out.msg = j.message || "Unknown Error");

	console.log(`Server Time: ${tzDate(Settings.serverTimezone, 0, "HH:mm:ss")}\n[${out.nickname} (${out.serverName})]\n${out.status}\n${out.msg}${typeof buildPlayerCard !== 'undefined' ? buildPlayerCard(p) : ""}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2, useEdit = Settings.discordUseEdit || false) {
	const store = PropertiesService.getScriptProperties(), key = Settings.discord_db, d = tzDate(), hooks = discordApp.filter(o => o.notify && o.discordWebhook);
	const k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	const { max: maxRetry = 5, initialBackoffMs: backoff = 1000 } = Settings.retry || {};

	let db = JSON.parse(store.getProperty(key) || '{"date":"","msgMap":{}}');
	if (!useEdit || (useEdit && Settings.discordDailyPost && db.date !== d)) store.setProperty(key, JSON.stringify(db = { date: d, msgMap: {} }));

	const getReset = (type, opt = {}) => {
		const { tz = Settings.serverTimezone, rt = Settings.serverResetTime, wd = 1, start = Settings.serverBPStartDate, cyc = Settings.serverBPCycle, unix = true, uTz = Settings.userTimezone } = opt;
		const curS = tz ? new Date(Utilities.formatDate(new Date(), tz, "MMMM dd, yyyy HH:mm:ss")) : new Date();
		const [h, m, s] = rt.split(':').map(Number), tgtS = new Date(curS);
		tgtS.setHours(h, m, s, 0);
		const getToUnix = (date) => {
			if (!unix) return date;
			if (!tz) return Math.floor(date.getTime() / 1000);
			const gO = t => { const z = Utilities.formatDate(new Date(), t, "Z"); return (z[0] === "+" ? 1 : -1) * (parseInt(z.slice(1, 3)) * 60 + parseInt(z.slice(3, 5))); };
			return Math.floor((date.getTime() - (gO(tz) - gO(uTz)) * 60000) / 1000);
		};
		const logic = {
			daily: () => curS >= tgtS ? new Date(tgtS.getTime() + 864e5) : tgtS,
			weekly: () => { let diff = (wd - tgtS.getDay() + 7) % 7 || 7; return new Date(tgtS.getTime() + ((diff === 7 && curS < tgtS ? 0 : diff) * 864e5)); },
			cycle: () => {
				const p = start.split("-"), bS = tz ? new Date(Utilities.formatDate(new Date(p[0], p[1] - 1, p[2]), tz, "MMMM dd, yyyy HH:mm:ss")) : new Date(p[0], p[1] - 1, p[2]);
				bS.setHours(h, m, s, 0);
				return new Date(bS.getTime() + (Math.floor((curS.getTime() - bS.getTime()) / (cyc * 864e5)) + 1) * (cyc * 864e5));
			}
		};
		return getToUnix(logic[type] ? logic[type]() : tgtS);
	};

	const embed = {
		title: `📝 Endfield - Report [<t:${Math.floor(new Date(Utilities.formatDate(new Date(), Settings.serverTimezone, "MMMM dd, yyyy HH:mm:ss")).getTime() / 1000)}:d>]`,
		color: rows.every(r => r.success) ? [0xFF0000, 0xFFFF00, 0xFF69B4, 0x00A86B, 0xFFA500, 0x00BFFF, 0x800080][new Date(d).getDay()] : 0x2F3136,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields: [
			{ name: "**Server Reset**", value: `🌸 Daily: <t:${getReset('daily')}:R>\n🗡️ Arsenal: <t:${getReset('weekly', { wd: Settings.serverResetArsenal })}:R>`, inline: true },
			{ name: `\u200B`, value: `📅 Weekly: <t:${getReset('weekly', { wd: Settings.serverResetWeekly })}:R>\n🌟 BP: <t:${getReset('cycle')}:R>`, inline: true },
			{ name: "", value: "", inline: false },
			...rows.flatMap((r, i) => [{
				name: `👤 **${r.nickname} (${r.serverName})**`,
				value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${r.msg.replace(/\n/g, '\n\u2003')}${buildPlayerCard(r, true).replace(/\n/g, '\n\u2003')}`,
				inline: true
			}, ...((i + 1) % colCount === 0 && i + 1 < rows.length ? [{ name: "", value: "", inline: false }] : [])])
		],
		footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
		timestamp: new Date().toISOString()
	};

	let activeHooks = hooks.map(h => {
		const hash = k(h.discordWebhook), msgId = db.msgMap[hash];
		return {
			...h, hash,
			url: (useEdit && msgId) ? `${h.discordWebhook}/messages/${msgId}` : h.discordWebhook + "?wait=true",
			method: (useEdit && msgId) ? "patch" : "post",
			payload: JSON.stringify({ username: "Endfield Assistant", avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png", embeds: [embed] }),
			contentType: "application/json", muteHttpExceptions: true
		};
	});

	for (let a = 1; a <= maxRetry && activeHooks.length > 0; a++) {
		const failed = [];
		chunkedFetchAll(activeHooks).forEach((r, i) => {
			const m = readMeta(r), hash = activeHooks[i].hash;
			if (m.code >= 200 && m.code < 300) {
				if (useEdit && m.json?.id) db.msgMap[hash] = m.json.id;
			} else failed.push(activeHooks[i]);
		});
		activeHooks = failed;
		if (activeHooks.length > 0 && a < maxRetry) setDelay(`discordPost`, backoff << (a - 1));
	}

	if (useEdit) store.setProperty(key, JSON.stringify(db));
}

const readMeta = r => ({ resp: r, json: parseJson(r?.getContentText() || ""), code: r?.getResponseCode() ?? null, rawText: r?.getContentText() || "" });
const parseJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const nowTs = () => String(Math.floor(Date.now() / 1000));
const bytesToHex = b => b.map(x => ("0" + ((x & 0xFF).toString(16))).slice(-2)).join("");
const setDelay = (s, d) => (d = Math.min(d, Settings.retry?.maxBackoffMs || d), console.warn(`${s} Retry in ${d}ms`), Utilities.sleep(d));
const buildPlayerCard = (p, b = false) => p?.playerCard ? `\n${b ? p.playerCard.loginTs : p.playerCard.loginTime}\n${p.playerCard.sanity}\n${b ? p.playerCard.maxSanityTs : p.playerCard.maxSanityTime}\n${p.playerCard.battlePass}\n${p.playerCard.daily}\n${p.playerCard.weekly}` : "";
const failedIdx = arr => arr.map((m, i) => (!m?.json || !Settings.successCodes.has(m.json.code) ? i : -1)).filter(i => i >= 0);
const tzDate = (tz = Settings.serverTimezone, hr = 0, f = "yyyy-MM-dd") => {
	const d = new Date(); if (Number(Utilities.formatDate(d, tz, "H")) < hr) d.setDate(d.getDate() - 1);
	return Utilities.formatDate(d, tz, f);
};

function generateSign(path, body, ts, token, plat, v) {
	const hJson = JSON.stringify({ platform: String(plat), timestamp: String(ts), dId: "", vName: String(v) });
	const hmac = Utilities.computeHmacSha256Signature(path + (body || "") + ts + hJson, token || "");
	return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytesToHex(hmac)));
}

function chunkedFetchAll(reqs) {
	const out = [], size = Settings.chunkSize || 20;
	for (let i = 0; i < reqs.length; i += size)
		try { out.push(...UrlFetchApp.fetchAll(reqs.slice(i, i + size))); }
		catch (e) { console.error(`Chunk error at index ${i}:`, e.message); out.push(...reqs.slice(i, i + size).map(() => ({ getContentText: () => "{}", getResponseCode: () => 500 }))); }
	return out;
}

const buildTokenRefresh = p => ({ url: Settings.endpoints.refresh, method: "get", muteHttpExceptions: true, headers: { "User-Agent": Settings.userAgent, ...Settings.defaultHeaders, cred: p.cred, platform: Settings.platform, vName: Settings.vName } });
const buildPlayerBindingRequest = (cred, tk) => {
	const ts = nowTs(); return { url: Settings.endpoints.binding, method: "get", muteHttpExceptions: true, headers: { cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-language": "en", sign: generateSign("/api/v1/game/player/binding", "", ts, tk, Settings.platform, Settings.vName) } };
};
const buildCardRequest = (cred, tk) => {
	const ts = nowTs(); return { url: Settings.endpoints.card, method: "get", muteHttpExceptions: true, headers: { cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-language": "en", sign: generateSign("/api/v1/game/endfield/card/detail", "", ts, tk, Settings.platform, Settings.vName) } };
};
const buildAttendRequest = (p, tk) => {
	const body = JSON.stringify({ role: p.skGameRole }), ts = nowTs();
	return { url: Settings.endpoints.attendance, method: "post", contentType: "application/json", payload: body, muteHttpExceptions: true, headers: { ...Settings.baseAttHeaders, cred: p.cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-game-role": p.skGameRole, sign: generateSign("/web/v1/game/endfield/attendance", body, ts, tk, Settings.platform, Settings.vName) } };
};
