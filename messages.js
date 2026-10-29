const db = require("./database");

function envoyerMessage(expediteur, destinataire, message) {
  if (!Number.isInteger(expediteur) || !Number.isInteger(destinataire)) {
    return { error: "Utilisateurs invalides." };
  }

  if (expediteur === destinataire) {
    return { error: "Impossible de s'envoyer un message." };
  }

  if (typeof message !== "string" || !message.trim() || message.length > 1000) {
    return { error: "Message invalide." };
  }

  const destinataireExiste = db.prepare(
    "SELECT id FROM users WHERE id = ?"
  ).get(destinataire);

  if (!destinataireExiste) {
    return { error: "Destinataire introuvable." };
  }

  const bloque = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?)
       OR (blocker_id = ? AND blocked_id = ?)
  `).get(expediteur, destinataire, destinataire, expediteur);

  if (bloque) {
    return { error: "Conversation indisponible." };
  }

  const result = db.prepare(`
    INSERT INTO private_messages (sender_id, receiver_id, message)
    VALUES (?, ?, ?)
  `).run(expediteur, destinataire, message.trim());

  return { id: Number(result.lastInsertRowid) };
}

module.exports = { envoyerMessage };
