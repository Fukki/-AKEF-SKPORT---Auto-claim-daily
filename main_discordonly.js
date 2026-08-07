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
	discordResetTime: "23:00:00", //format "HH:MM:SS" *must same rewardResetTime and set when discordDailyPost = true
	rewardResetTime: "23:00:00", //format "HH:MM:SS"
	serverDailyReset: "03:00:00", //format "HH:MM:SS"
	serverWeelyReset: [1, "03:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverArsenalReset: [4, "11:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverBPCycleStart: "2026-07-16 11:00:00", //format "YYYY-MM-DD HH:MM:SS"
	serverBPCycleEnd: [48, "05:00:00"], //format [Cycle, HH:MM:SS] *Cycle = number of days (normally 35, 42, 49 days)
	reward_db: "reward_db", //PropertiesService *just name
	discord_db: "discord_db", //can be checked in Project Settings > Script Properties
	discordColumn: 2, //max 3 col in 1 row
	discordUseEdit: true, //update with edit post
	discordDailyPost: true, //new post everyday follow discordResetTime
	retry: { max: 5, initialBackoffMs: 500, maxBackoffMs: 5000 },
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

	let tokens = chunkedFetchAll(
		profiles.map(buildTokenRefresh),
		r => { const m = readMeta(r); return m?.code === 10002 || !!m?.json?.data?.token; }
	).map(r => ((m = readMeta(r)) => m?.code === 10002 ? "" : (m?.json?.data?.token ?? null))());

	const resolved = profiles.map((p, i) => (tokens[i] === "" || tokens[i] === null)
		? { ...p, token: tokens[i], skGameRole: p.skGameRole || "", nickname: p.accountName || "", serverName: p.serverName || "", playerCard: {} }
		: { ...p, token: tokens[i] });

	const bindIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (bindIdx.length) {
		chunkedFetchAll(
			bindIdx.map(i => buildPlayerBindingRequest(resolved[i].cred || "", resolved[i].token)),
			r => { const m = readMeta(r); return m?.json && Settings.successCodes.has(m.json.code); }
		).forEach((r, k) => resolved[bindIdx[k]].bind = readMeta(r));
		
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
		chunkedFetchAll(
			cardIdx.map(i => buildCardRequest(resolved[i].cred || "", resolved[i].token)),
			r => { const m = readMeta(r); return m?.json && Settings.successCodes.has(m.json.code); }
		).forEach((r, k) => resolved[cardIdx[k]].card = readMeta(r));
		
		cardIdx.forEach(i => {
			const d = resolved[i].card?.json?.data?.detail;
			if (!d) return;
			resolved[i].playerCard = d;
		});
	}

	const reqIdx = resolved.map((p, i) => (p.token === "" || p.token === null) ? -1 : i).filter(i => i !== -1);
	if (reqIdx.length) {
		chunkedFetchAll(
			reqIdx.map(i => buildAttendRequest(resolved[i], resolved[i].token)),
			r => { const m = readMeta(r); return m?.json && Settings.successCodes.has(m.json.code); }
		).forEach((r, k) => resolved[reqIdx[k]].meta = readMeta(r));
	}

	const results = resolved.map((p, i) => formatResult(p, p.meta, i));
	discordPost(results);
	saveWebData(results);
	return results;
}

function formatResult(p, meta, i) {
	const store = PropertiesService.getScriptProperties(), key = Settings.reward_db;
	let db = JSON.parse(store.getProperty(key) || '{"date":"","items":{},"accounts":{}}');
	const checkReset = checkDailyReset(db.date, Settings.rewardResetTime || "00:00:00");
	if (checkReset.isReset) store.setProperty(key, JSON.stringify(db = { date: checkReset.date, items: {}, accounts: {} }));
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
	console.log(`[${out.nickname} (${out.serverName})]\n${out.status}\n${out.msg}${typeof buildPlayerCard !== 'undefined' ? buildPlayerCard(p) : ""}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2, useEdit = Settings.discordUseEdit || false) {
	const store = PropertiesService.getScriptProperties(), key = Settings.discord_db;
	const hooks = discordApp.filter(o => o.notify && o.discordWebhook);
	const k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	
	let db = JSON.parse(store.getProperty(key) || '{"date":"","msgMap":{}}');
	const checkReset = checkDailyReset(db.date, Settings.discordResetTime || "00:00:00");
	if (!useEdit || (useEdit && Settings.discordDailyPost && checkReset.isReset)) {
		const finalDate = !useEdit && !checkReset.isReset ? checkResetCycle("", "").date : checkReset.date;
		store.setProperty(key, JSON.stringify(db = { date: finalDate, msgMap: {} }));
	}
	
	const getReset = (type, opt, extra) => {
		const n = new Date(), o = type == 'cycle' ? extra : opt;
		const [a, rt = "00:00:00"] = Array.isArray(o) ? (type == 'daily' ? [0, o[0]] : o) : [o?.wd ?? o?.cyc ?? 0, o?.rt ?? o];
		const t = new Date(n);
		t.setHours(...rt.split(':'), 0);
		if (type != 'cycle') {
			const d = type == 'weekly' ? (a - n.getDay() + 7) % 7 : 0;
			t.setDate(t.getDate() + d + (!d && t <= n ? (type == 'weekly' ? 7 : 1) : 0));
			return Math.floor(t / 1000);
		}
		const b = new Date(opt.replace(" ", "T")), cyc = a * 864e5;
		b.setHours(...rt.split(':'), 0);
		return Math.floor((+b + Math.ceil((n - b + 1) / cyc) * cyc) / 1000);
	};

	const embed = {
		title: `📝 Endfield - Report [<t:${nowTs()}:d>]`,
		color: rows.every(r => r.success) ? [0xFF0000, 0xFFFF00, 0xFF69B4, 0x00A86B, 0xFFA500, 0x00BFFF, 0x800080][new Date().getDay()] : 0x2F3136,
		thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
		fields: [
			{ name: "**Useful Link**", value: "[App](https://script.google.com/home/my) | [Home](https://endfield.gryphline.com/) | [Sched](https://endfield.gryphline.com/en-us#calendar) | [SKP](https://www.skport.com/) | [Wiki](https://wiki.skport.com/endfield) | [Guide](https://www.prydwen.gg/arknights-endfield/) | [Map](https://opendfieldmap.org/) | [BP#1](https://endfieldtools.dev/community-factories/) | [BP#2](https://talospioneers.com) | [Ess](https://endfieldtools.dev/weapon-essence-solver/)", inline: false },
			{ name: "**Server Reset**", value: `🌸 Daily: <t:${getReset('daily', Settings.serverDailyReset)}:R>\n🗡️ Arsenal: <t:${getReset('weekly', Settings.serverArsenalReset)}:R>`, inline: true },
			{ name: `\u200B`, value: `📅 Weekly: <t:${getReset('weekly', Settings.serverWeelyReset)}:R>\n🌟 BP: <t:${getReset('cycle', Settings.serverBPCycleStart, Settings.serverBPCycleEnd)}:R>`, inline: true },
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

	const activeHooks = hooks.map(h => {
		const hash = k(h.discordWebhook), msgId = db.msgMap[hash];
		return {
			...h, hash,
			url: (useEdit && msgId) ? `${h.discordWebhook}/messages/${msgId}` : h.discordWebhook + "?wait=true",
			method: (useEdit && msgId) ? "PATCH" : "POST",
			payload: JSON.stringify({ username: "Endfield Assistant", avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png", embeds: [embed] }),
			contentType: "application/json", muteHttpExceptions: true
		};
	});

	if (activeHooks.length > 0) {
		chunkedFetchAll(activeHooks, r => r.getResponseCode() >= 200 && r.getResponseCode() < 300)
			.forEach((r, i) => {
				const m = readMeta(r), hash = activeHooks[i].hash;
				if (m.code >= 200 && m.code < 300 && useEdit && m.json?.id) {
					db.msgMap[hash] = m.json.id;
				}
			});
	}

	if (useEdit) store.setProperty(key, JSON.stringify(db));
}

const buildPlayerCard = (p, b = false) => {
	if (!p?.playerCard) return "";
	const { base: bs, domain: dl, dungeon: dg, bpSystem: bp, dailyMission: dm, weeklyMission: wm } = p.playerCard, en = +dg.curStamina, em = +dg.maxStamina;

	const wrap = t => b ? `\`${t}\`` : t;
	const gTs = (c, m, s = 432000) => Math.floor(c >= m ? Date.now() : (Math.ceil(Date.now() / s) * s + (m - c - 1) * s) / 1e3);
	const fmt = ts => {
		if (b) return `<t:${ts}:R>`;
		const d = (((ts > 1e11 ? ts / 1e3 : ts) - Date.now() / 1e3) | 0), a = Math.abs(d), f = (n, u) => d > 0 ? `in ${n} ${u}${n > 1 ? "s" : ""}` : `${n} ${u}${n > 1 ? "s" : ""} ago`;
		return a < 60 ? f(a, "sec") : a < 3600 ? f((a / 60) | 0, "min") : a < 864e2 ? f((a / 3600) | 0, "hour") : a < 6048e2 ? f((a / 864e2) | 0, "day") : a < 2592e3 ? f((a / 6048e2) | 0, "week") : a < 31536e3 ? f((a / 2592e3) | 0, "month") : f((a / 31536e3) | 0, "year");
	};

	const shn = (n, d = 2, f = false) => {
		let uIdx = 0, num = +n, units = ["", "k", "m", "b", "t", "qa", "qi", "sx", "sp", "oc", "no", "dc"];
		while (num >= 1000 && uIdx < units.length - 1) { num /= 1000; uIdx++; }
		return (f ? num.toFixed(d) : (Number.isInteger(num) ? num.toString() : num.toFixed(d).replace(/\.?0+$/, ""))) + units[uIdx];
	};

	let aSum = 0, aMax = 0, aStr = "";
	dl.forEach(d => {
		const s = d.settlements.filter(x => +x.level > 0), cur = s.reduce((a, x) => a + +x.remainMoney, 0), max = s.reduce((a, x) => a + +x.moneyMax, 0), fd = s.filter(x => +x.remainMoney === +x.moneyMax).length;
		const remainList = s.map((x, i) => `\u2003\u2003[${i + 1}]: ${shn(x.remainMoney)}/${shn(x.moneyMax)}`).join("\n");
		aSum += cur; aMax += max;
		aStr += `\n\u2003→ ${d.name.trim().split(/\s+/)[0]} [${fd}/${s.length}]: ${s.length > 0 && fd === s.length ? wrap("Fulled") : `${max ? ((cur / max) * 100).toFixed(2) : "0.00"}%`}${remainList ? "\n" + remainList : ""}`;
	});

	const eStr = cap => en >= cap ? wrap("Fulled") : fmt(gTs(en, cap));

	return `\n🔑 Login: ${fmt(bs.lastLoginTime)}\n🌸 Daily: ${dm.dailyActivation}/${dm.maxDailyActivation}\n📅 Weekly: ${wm.score}/${wm.total}\n🌟 BP: ${bp.curLevel}/${bp.maxLevel}\n⚡️ Energy: ${en}/${em}\n${[160, 200, 240, em].map(v => `\u2003→ ${v}: ${eStr(v)}`).join("\n")}\n🏠 AIC Funds: ${aMax ? ((aSum / aMax) * 100).toFixed(2) : "0.00"}%${aStr}`;
};

function doGet(e) {
	return HtmlService.createHtmlOutputFromFile('Index')
		.setTitle('Endfield - Dashboard')
		.addMetaTag('viewport', 'width=device-width, initial-scale=1')
		.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getWebData() {
	const s = PropertiesService.getScriptProperties();
	const m = JSON.parse(s.getProperty('web_meta') || 'null');
	return m ? JSON.parse(Array.from({length: m.chunks}, (_, i) => s.getProperty('web_chunk_' + i)).join('')) : { updatedAt: Date.now(), accounts: [] };
}

function getNextResetTimestamps(st) {
	const now = new Date();
	
	const parseTime = (t) => t.split(':').map(Number);
	
	const getNextTimeToday = (timeStr) => {
		const [h, m, s] = parseTime(timeStr);
		const target = new Date(now);
		target.setHours(h, m, s, 0);
		if (target <= now) target.setDate(target.getDate() + 1);
		return Math.floor(target.getTime() / 1000);
	};
	
	const getNextDayOfWeek = (dow, timeStr) => {
		const [h, m, s] = parseTime(timeStr);
		const target = new Date(now);
		target.setHours(h, m, s, 0);
		let diff = dow - target.getDay();
		if (diff < 0 || (diff === 0 && target <= now)) diff += 7;
		target.setDate(target.getDate() + diff);
		return Math.floor(target.getTime() / 1000);
	};

	const getNextBpReset = (startStr, [cycleDays, timeStr]) => {
		const [h, m, s] = parseTime(timeStr);
		const startMs = new Date(startStr).getTime();
		const cycleMs = cycleDays * 86400000;
		const nowMs = now.getTime();
		if (nowMs < startMs) return Math.floor(startMs / 1000);
		const cycleIndex = Math.floor((nowMs - startMs) / cycleMs);
		const target = new Date(startMs + (cycleIndex + 1) * cycleMs);
		target.setHours(h, m, s, 0);
		if (target.getTime() <= nowMs) target.setTime(target.getTime() + cycleMs);
		return Math.floor(target.getTime() / 1000);
	};

	return {
		daily: getNextTimeToday(st.serverDailyReset),
		weekly: getNextDayOfWeek(st.serverWeelyReset[0], st.serverWeelyReset[1]),
		arsenal: getNextDayOfWeek(st.serverArsenalReset[0], st.serverArsenalReset[1]),
		bp: getNextBpReset(st.serverBPCycleStart, st.serverBPCycleEnd)
	};
}

function saveWebData(results) {
	const s = PropertiesService.getScriptProperties();
	const d = JSON.stringify({
		updatedAt: Date.now(),
		serverReset: getNextResetTimestamps(Settings),
		accounts: results.map(({nickname, serverName, success, status, msg, itemIcon_url, playerCard: p}) => ({
			nickname, serverName, success, status, msg, itemIcon_url,
			playerCard: p?.base ? {
				base: { lastLoginTime: p.base.lastLoginTime, avatarUrl: p.base.avatarUrl },
				dungeon: { curStamina: p.dungeon.curStamina, maxStamina: p.dungeon.maxStamina },
				bpSystem: { curLevel: p.bpSystem.curLevel, maxLevel: p.bpSystem.maxLevel },
				dailyMission: { dailyActivation: p.dailyMission.dailyActivation, maxDailyActivation: p.dailyMission.maxDailyActivation },
				weeklyMission: { score: p.weeklyMission.score, total: p.weeklyMission.total },
				domain: (p.domain || []).map(d => ({ name: d.name, settlements: (d.settlements || []).filter(x => +x.level > 0).map(({level, remainMoney, moneyMax}) => ({level, remainMoney, moneyMax})) }))
			} : null
		}))
	});
	
	const chunks = Math.ceil(d.length / 8000);
	Object.keys(s.getProperties()).forEach(k => (k.startsWith('web_chunk_') || k === 'web_display_data') && s.deleteProperty(k));
	s.setProperty('web_meta', JSON.stringify({ chunks, updatedAt: Date.now() }));
	for (let i = 0; i < chunks; i++) {
		s.setProperty('web_chunk_' + i, d.substring(i * 8000, i * 8000 + 8000));
	}
}

const readMeta = r => ({ resp: r, json: parseJson(r?.getContentText() || ""), code: r?.getResponseCode() ?? null, rawText: r?.getContentText() || "" });
const readJson = (o, size = 5000) => { const s = new WeakSet(), str = JSON.stringify(o, (k, v) => typeof v === "object" && v ? (s.has(v) ? "[Circular]" : (s.add(v), v)) : v, 2); for (let i = 0; i < str.length; i += size) console.log(str.slice(i, i + size)); };
const parseJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const nowTs = () => String(Math.floor(Date.now() / 1000));
const bytesToHex = b => b.map(x => ("0" + ((x & 0xFF).toString(16))).slice(-2)).join("");
const checkDailyReset = (d, t = "00:00:00") => {
	const n = new Date(), [y, m, x] = (d || "").split("-").map(Number), td = new Date(n - n.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
	const r = !d || (g => (g.setDate(g.getDate() + 1), !(g > n)))(new Date(y, m - 1, x, ...t.split(":").map(Number)));
	return { date: r ? td : d, isReset: r };
};

function generateSign(path, body, ts, token, plat, v) {
	const hJson = JSON.stringify({ platform: String(plat), timestamp: String(ts), dId: "", vName: String(v) });
	const hmac = Utilities.computeHmacSha256Signature(path + (body || "") + ts + hJson, token || "");
	return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytesToHex(hmac)));
}

function chunkedFetchAll(reqs, isValid = r => r.getResponseCode() >= 200 && r.getResponseCode() < 300) {
	const { chunkSize: sz = 20, retry: { max = 5, initialBackoffMs: bf = 500, maxBackoffMs: mBf = 5000 } = {} } = Settings;
	const err = () => ({ getContentText: () => "{}", getResponseCode: () => 500 });
	return Array.from({ length: Math.ceil(reqs.length / sz) }, (_, i) => reqs.slice(i * sz, (i + 1) * sz)).flatMap(chk => {
		let res; try { res = UrlFetchApp.fetchAll(chk); } catch (e) { console.error(`Batch Error: ${e.message}`); res = chk.map(err); }
		return res.map((r, j) => {
			for (let a = 0, rq = chk[j], d; a < max && !isValid(r); a++) {
				console.warn(`[Retry ${a+1}/${max}] ${rq.url || "Req"} (Status: ${r.getResponseCode()}) in ${d = Math.min(bf << a, mBf)}ms`);
				Utilities.sleep(d);
				try { r = UrlFetchApp.fetch(rq.url, rq); } catch (e) { console.error(`Fetch Error: ${e.message}`); r = err(); }
			}
			return r;
		});
	});
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
