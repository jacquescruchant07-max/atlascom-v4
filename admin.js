module.exports = function(app, db) {

  function adminOnly(req, res, next) {
    if (!req.session.user || Number(req.session.user.id) !== 1) {
      return res.status(403).send("Accès interdit");
    }
    next();
  }

  app.get("/api/admin/data", adminOnly, (req, res) => {
    const users = db.prepare(
      "SELECT id, pseudo FROM users ORDER BY id"
    ).all();

    const reports = db.prepare(`
      SELECT reports.id,
             a.pseudo AS reporter,
             b.pseudo AS reported,
             reports.reason,
             reports.created_at
      FROM reports
      JOIN users a ON a.id = reports.reporter_id
      JOIN users b ON b.id = reports.reported_id
      ORDER BY reports.id DESC
    `).all();

    const messages = db.prepare(
      "SELECT COUNT(*) AS total FROM private_messages"
    ).get().total;

    const sanctions = db.prepare(`
      SELECT s.id, u.pseudo, s.reason,
             s.created_at, s.expires_at
      FROM sanctions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.id DESC
      LIMIT 100
    `).all();

    res.json({
      users,
      reports,
      sanctions,
      stats: {
        users: users.length,
        reports: reports.length,
        messages
      }
    });
  });

  app.get("/admin", adminOnly, (req, res) => {
    res.sendFile(__dirname + "/public/admin.html");
  });
};
