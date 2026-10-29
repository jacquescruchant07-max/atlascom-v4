const activity = new Map();
const Database = require("better-sqlite3");
const db = new Database(__dirname + "/atlascom.db");

function suspend(id, reason, duration) {
  const now = Date.now();

  db.prepare(`
    INSERT INTO sanctions
    (user_id, reason, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(Number(id), reason, now, now + duration);
}

function getSuspension(id) {
  return db.prepare(`
    SELECT expires_at
    FROM sanctions
    WHERE user_id = ? AND expires_at > ?
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(Number(id), Date.now());
}

function checkMessage(userId, message) {
  const id = String(userId);
  const now = Date.now();
  const text = String(message || "").trim();

  const suspension = getSuspension(id)?.expires_at;

  if (suspension && suspension > now) {
    const minutes = Math.ceil((suspension - now) / 60000);

    return {
      allowed: false,
      reason: `Compte temporairement suspendu (${minutes} min).`
    };
  }


  if (!text) {
    return { allowed: false, reason: "Message vide." };
  }

  if (text.length > 2000) {
    return { allowed: false, reason: "Message trop long." };
  }

  let data = activity.get(id);

  if (!data) {
    data = {
      messages: [],
      lastText: "",
      duplicates: 0,
      warnings: 0
    };

    activity.set(id, data);
  }

  data.messages = data.messages.filter(t => now - t < 10000);

  if (data.messages.length >= 6) {
    data.warnings++;

    if (data.warnings >= 3) {
      suspend(id, "Spam ou messages répétés", 10 * 60000);
      data.warnings = 0;

      return {
        allowed: false,
        reason: "Spam détecté : suspension de 10 minutes."
      };
    }

    return {
      allowed: false,
      reason: "Tu envoies trop de messages. Ralentis."
    };
  }

  if (text.toLowerCase() === data.lastText) {
    data.duplicates++;
  } else {
    data.duplicates = 0;
  }

  data.lastText = text.toLowerCase();

  if (data.duplicates >= 3) {
    suspend(id, "Spam ou messages répétés", 10 * 60000);

    return {
      allowed: false,
      reason: "Messages répétés : suspension de 10 minutes."
    };
  }

  data.messages.push(now);

  return { allowed: true };
}

module.exports = { checkMessage };
