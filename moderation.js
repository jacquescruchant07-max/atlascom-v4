module.exports = function(app, db) {

  app.post("/api/bloquer", (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: "Non connecté" });

    const pseudo = String(req.body?.pseudo || "").trim();
    const target = db.prepare(
      "SELECT id FROM users WHERE pseudo = ?"
    ).get(pseudo);

    if (!target) return res.status(404).json({ error: "Utilisateur introuvable" });
    if (target.id === user.id) return res.status(400).json({ error: "Impossible de se bloquer soi-même" });

    db.prepare(
      "INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)"
    ).run(user.id, target.id);

    res.json({ success: true });
  });

  app.post("/api/signaler", (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: "Non connecté" });

    const pseudo = String(req.body?.pseudo || "").trim();
    const reason = String(req.body?.reason || "").trim();

    if (reason.length < 5 || reason.length > 500) {
      return res.status(400).json({ error: "Motif entre 5 et 500 caractères" });
    }

    const target = db.prepare(
      "SELECT id FROM users WHERE pseudo = ?"
    ).get(pseudo);

    if (!target) return res.status(404).json({ error: "Utilisateur introuvable" });
    if (target.id === user.id) return res.status(400).json({ error: "Signalement invalide" });

    db.prepare(
      "INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)"
    ).run(user.id, target.id, reason);

    res.json({ success: true });
  });


  app.post("/api/debloquer", (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: "Non connecté" });

    const pseudo = String(req.body?.pseudo || "").trim();

    const target = db.prepare(
      "SELECT id FROM users WHERE pseudo = ?"
    ).get(pseudo);

    if (!target) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    db.prepare(
      "DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?"
    ).run(user.id, target.id);

    res.json({ success: true });
  });

};
