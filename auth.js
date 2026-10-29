const bcrypt = require("bcrypt");
const db = require("./database");

function inscription(pseudo, password) {
  if (typeof pseudo !== "string" || typeof password !== "string") {
    return { error: "Informations invalides." };
  }

  pseudo = pseudo.trim();

  if (!/^[a-zA-Z0-9_-]{3,25}$/.test(pseudo)) {
    return { error: "Pseudonyme : 3 à 25 caractères, lettres, chiffres, _ ou -." };
  }

  if (password.length < 12 || password.length > 128) {
    return { error: "Le mot de passe doit contenir entre 12 et 128 caractères." };
  }

  const existing = db.prepare(
    "SELECT id FROM users WHERE pseudo = ?"
  ).get(pseudo);

  if (existing) {
    return { error: "Ce pseudonyme est déjà utilisé." };
  }

  const hash = bcrypt.hashSync(password, 12);

  try {
    const result = db.prepare(
      "INSERT INTO users (pseudo, password_hash) VALUES (?, ?)"
    ).run(pseudo, hash);

    return { id: Number(result.lastInsertRowid), pseudo };
  } catch {
    return { error: "Impossible de créer ce compte." };
  }
}

function connexion(pseudo, password) {
  if (typeof pseudo !== "string" || typeof password !== "string") {
    return { error: "Identifiants incorrects." };
  }

  const user = db.prepare(
    "SELECT * FROM users WHERE pseudo = ?"
  ).get(pseudo.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return { error: "Identifiants incorrects." };
  }

  return { id: user.id, pseudo: user.pseudo };
}

module.exports = { inscription, connexion };
