const express = require("express");
const db = require("./database");
const { envoyerMessage } = require("./messages");

const session = require("express-session");
const crypto = require("crypto");
const { inscription, connexion } = require("./auth");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const server = http.createServer(app);
const io = new Server(server);


app.use(express.json({ limit: "10kb" }));
const SqliteStore = require("better-sqlite3-session-store")(session);
const sessionDb = require("better-sqlite3")(process.env.SESSION_DB_PATH || "atlascom-sessions.db");

const sessionMiddleware = session({
  store: new SqliteStore({
    client: sessionDb,
    expired: {
      clear: true,
      intervalMs: 900000
    }
  }),
  name: "atlascom.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);
require("./moderation")(app, db);
require("./admin")(app, db);


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

app.post("/api/inscription", authLimiter, (req, res) => {
  const result = inscription(req.body?.pseudo, req.body?.password);
  if (result.error) return res.status(400).json(result);
  req.session.user = { id: result.id, pseudo: result.pseudo };
  req.session.save(err => {
    if (err) return res.status(500).json({ error: "Erreur de session" });
    res.status(201).json({ success: true, pseudo: result.pseudo });
  });
});

app.post("/api/connexion", authLimiter, (req, res) => {
  const result = connexion(req.body?.pseudo, req.body?.password);
  if (result.error) return res.status(401).json(result);
  req.session.user = { id: result.id, pseudo: result.pseudo };
  req.session.save(err => {
    if (err) return res.status(500).json({ error: "Erreur de session" });
    res.json({ success: true, pseudo: result.pseudo });
  });
});


app.get("/messages", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/");
  }
  res.sendFile(require("path").join(__dirname, "public", "messages.html"));
});

app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Non connecté" });
  }
  res.json(req.session.user);
});

app.get("/api/conversations", (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Non connecté" });

  const rows = db.prepare(`
    SELECT u.pseudo,
      (SELECT p.message FROM private_messages p
       WHERE (p.sender_id = u.id AND p.receiver_id = ?)
          OR (p.sender_id = ? AND p.receiver_id = u.id)
       ORDER BY p.id DESC LIMIT 1) AS lastMessage
    FROM users u
    WHERE u.id != ?
      AND EXISTS (
        SELECT 1 FROM private_messages p
        WHERE (p.sender_id = u.id AND p.receiver_id = ?)
           OR (p.sender_id = ? AND p.receiver_id = u.id)
      )
    ORDER BY (
      SELECT MAX(p.id) FROM private_messages p
      WHERE (p.sender_id = u.id AND p.receiver_id = ?)
         OR (p.sender_id = ? AND p.receiver_id = u.id)
    ) DESC
  `).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id);

  res.json(rows);
});

app.get("/api/messages/:pseudo", (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Non connecté" });

  const other = db.prepare(
    "SELECT id FROM users WHERE pseudo = ?"
  ).get(req.params.pseudo);

  if (!other) return res.status(404).json({ error: "Utilisateur introuvable" });

  const blocked = db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?)
       OR (blocker_id = ? AND blocked_id = ?)
  `).get(user.id, other.id, other.id, user.id);

  if (blocked) return res.status(403).json({ error: "Conversation indisponible" });

  const rows = db.prepare(`
    SELECT p.id, u.pseudo AS sender, p.message, p.created_at
    FROM private_messages p
    JOIN users u ON u.id = p.sender_id
    WHERE (p.sender_id = ? AND p.receiver_id = ?)
       OR (p.sender_id = ? AND p.receiver_id = ?)
    ORDER BY p.id DESC LIMIT 100
  `).all(user.id, other.id, other.id, user.id).reverse();

  res.json(rows);
});

const salons = ["Général", "Rencontres", "Musique", "Gaming", "Nautisme"];
const utilisateurs = new Map();

app.get("/", (req, res) => {
res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATLASCOM — Network</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#090c12;color:#fff;font-family:Arial,sans-serif}
header{height:70px;background:#101622;border-bottom:1px solid #263044;display:flex;align-items:center;justify-content:space-between;padding:0 30px}
.logo{font-size:26px;font-weight:900;letter-spacing:3px}
.logo span{color:#438bff}
.online{color:#8b9ab3;font-size:13px}
.layout{display:grid;grid-template-columns:230px 1fr 220px;height:calc(100dvh - 70px)}
aside{background:#101622;padding:20px;overflow:auto}
.left{border-right:1px solid #263044}
.right{border-left:1px solid #263044}
h3{font-size:12px;color:#788ba8;letter-spacing:2px;margin-bottom:20px}
.room{padding:14px;border-radius:9px;cursor:pointer;color:#b5c2d6;margin-bottom:7px}
.room:hover,.room.active{background:#203454;color:#fff}
.chat{display:flex;flex-direction:column;min-width:0}
.chathead{padding:20px;border-bottom:1px solid #263044;font-weight:bold}
#messages{flex:1;overflow-y:auto;padding:25px}
.msg{padding:13px;margin-bottom:12px;background:#151e2d;border-radius:12px;overflow-wrap:anywhere}
.author{color:#65a2ff;font-size:13px;font-weight:bold;margin-bottom:6px}
form{display:flex;padding:20px;gap:10px;border-top:1px solid #263044}
input{background:#192334;color:#fff;border:1px solid #30415c;border-radius:9px;padding:14px;min-width:0}
#message{flex:1}
button{background:#377cf6;color:white;border:0;border-radius:9px;padding:14px;cursor:pointer}
.member{padding:12px;color:#b5c2d6;overflow-wrap:anywhere}
.dot{color:#3fe29a;margin-right:8px}
#login{position:fixed;inset:0;background:#090c12;display:flex;align-items:center;justify-content:center;z-index:10;padding:20px}
.loginbox{background:#151e2d;padding:35px;border-radius:18px;width:100%;max-width:400px;text-align:center}
.loginbox input,.loginbox button{width:100%;margin-top:15px}
.notice{color:#93a3bc;font-size:12px;line-height:1.5}
@media(max-width:750px){
.layout{grid-template-columns:110px 1fr}
.right{display:none}
aside{padding:10px}
.room{font-size:12px;padding:10px}
header{padding:0 15px}
.logo{font-size:20px}
#messages{padding:12px}
form{padding:10px}
}
</style>
</head>
<body>

<div id="login">
<div class="loginbox">
<h1>ATLASCOM</h1>
<p>Un univers de conversations.</p>
<input id="pseudo" maxlength="25" placeholder="Pseudonyme">
<input id="password" type="password" maxlength="128" placeholder="Mot de passe (12 caractères minimum)">
<button id="enter">Se connecter</button>
<button id="signup" type="button">Créer un compte</button>
<p id="authError" class="notice" role="alert"></p>
<p class="notice">Prototype local. Réservé aux adultes. Ne partage pas d'informations personnelles.</p>
</div>
</div>

<header>
<div class="logo">ATLAS<span>COM</span></div>
<div class="online"><span id="count">0</span> membre(s) connecté(s)</div>
</header>

<div class="layout">
<aside class="left">
<h3>SALONS</h3>
<a href="/messages" style="display:block;background:#203454;color:white;padding:14px;border-radius:9px;text-decoration:none;margin-bottom:20px">
💬 Messages privés <span id="notifMP" style="display:none;background:red;color:white;border-radius:20px;padding:3px 8px">●</span>
</a>
<div id="rooms"></div>
</aside>

<section class="chat">
<div class="chathead" id="roomtitle"># Général</div>
<div id="messages"></div>
<form id="form">
<input id="message" maxlength="1000" placeholder="Écris un message..." required>
<button>Envoyer</button>
</form>
</section>

<aside class="right">
<h3>EN LIGNE</h3>
<div id="members"></div>
</aside>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io();
const rooms=["Général","Rencontres","Musique","Gaming","Nautisme"];
let current="Général";
let pseudo="";

const messages=document.getElementById("messages");
const roomList=document.getElementById("rooms");

function renderRooms(){
roomList.replaceChildren();
rooms.forEach(room=>{
const div=document.createElement("div");
div.className="room"+(room===current?" active":"");
div.textContent="# "+room;
div.onclick=()=>{
current=room;
messages.replaceChildren();
document.getElementById("roomtitle").textContent="# "+room;
socket.emit("join",room);
renderRooms();
};
roomList.appendChild(div);
});
}


async function authenticate(endpoint){
const name=document.getElementById("pseudo").value.trim();
const password=document.getElementById("password").value;
const error=document.getElementById("authError");
error.textContent="";
try{
const response=await fetch(endpoint,{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({pseudo:name,password})
});
const result=await response.json();
if(!response.ok){
error.textContent=result.error||"Une erreur est survenue.";
return;
}
pseudo=result.pseudo;
socket.disconnect();
socket.connect();
socket.once("connect",()=>{
socket.emit("register");
});
document.getElementById("login").style.display="none";
document.getElementById("password").value="";
renderRooms();
}catch{
error.textContent="Impossible de contacter le serveur.";
}
}


async function restaurerSession(){
  try {
    const response = await fetch("/api/me");
    if (!response.ok) return;

    const user = await response.json();
    pseudo = user.pseudo;

    document.getElementById("login").style.display = "none";

    socket.disconnect();
    socket.connect();
    socket.once("connect", () => {
      socket.emit("register");
    });

    console.log("Session restaurée :", pseudo);
  } catch (error) {
    console.error("Erreur de restauration :", error);
  }
}

restaurerSession();

document.getElementById("enter").onclick=()=>authenticate("/api/connexion");
document.getElementById("signup").onclick=()=>authenticate("/api/inscription");

document.getElementById("form").onsubmit=e=>{
e.preventDefault();
const input=document.getElementById("message");
const message=input.value.trim();
if(!pseudo||!message)return;
socket.emit("message",{room:current,message});
input.value="";
};

socket.on("message",data=>{
if(data.room!==current)return;
const div=document.createElement("div");
div.className="msg";
const author=document.createElement("div");
author.className="author";
author.textContent=data.pseudo;
const body=document.createElement("div");
body.textContent=data.message;
div.append(author,body);
messages.appendChild(div);
messages.scrollTop=messages.scrollHeight;
});

socket.on("privateMessage",data=>{
const div=document.createElement("div");
div.className="msg";
if(data.to === pseudo && data.from !== pseudo){
  const notif = document.getElementById("notifMP");
  if(notif) notif.style.display = "inline";
}

const author=document.createElement("div");
author.className="author";
author.textContent="🔒 "+data.from+" → "+data.to;
const body=document.createElement("div");
body.textContent=data.message;
div.append(author,body);
messages.appendChild(div);
messages.scrollTop=messages.scrollHeight;
});

socket.on("privateError",error=>{
alert(error);
});

socket.on("members",list=>{
document.getElementById("count").textContent=list.length;
const box=document.getElementById("members");
box.replaceChildren();
list.forEach(name=>{
const div=document.createElement("div");
div.className="member";
const dot=document.createElement("span");
dot.className="dot";
dot.textContent="●";
div.append(dot,document.createTextNode(name));

if(name!==pseudo){
const btn=document.createElement("button");
btn.textContent="Message privé";
btn.style.marginLeft="10px";
btn.style.padding="7px";
btn.onclick=()=>{
const message=prompt("Message privé à "+name+" :");
if(!message || !message.trim())return;
socket.emit("privateMessage",{
pseudo:name,
message:message.trim().slice(0,1000)
});
};
div.appendChild(btn);
}

box.appendChild(div);
});
});
</script>
</body>
</html>
`);
});

function updateMembers(){
io.emit("members",[...new Set([...utilisateurs.values()].map(u=>u.pseudo))]);
}

const { checkMessage } = require("./auto-moderation");

io.on("connection",socket=>{
socket.on("register",()=>{
const account = socket.request.session?.user;
if(!account)return;
utilisateurs.set(socket.id,{
  id:account.id,
  pseudo:account.pseudo,
  room:"Général"
});
socket.join("Général");
updateMembers();
});

socket.on("privateMessage",data=>{
const account = socket.request.session?.user;
let sender = utilisateurs.get(socket.id);
if (account && !sender) {
  sender = {
    id: account.id,
    pseudo: account.pseudo,
    room: "Général"
  };
  utilisateurs.set(socket.id, sender);
}

if(!account || !sender || sender.id!==account.id)return;
if(!data || typeof data.pseudo!=="string")return;

const recipient = db.prepare(
  "SELECT id, pseudo FROM users WHERE pseudo = ?"
).get(data.pseudo.trim());

if(!recipient)return;

if(typeof data.message !== "string")return;

const check = checkMessage(account.id, data.message);

if(!check.allowed){
  socket.emit("privateError", check.reason);
  return;
}

const result = envoyerMessage(
  account.id,
  recipient.id,
  data.message
);

if(result.error){
  socket.emit("privateError",result.error);
  return;
}

const payload = {
  id:result.id,
  from:account.pseudo,
  to:recipient.pseudo,
  message:data.message.trim()
};

for(const [socketId,user] of utilisateurs){
  if(user.id===account.id || user.id===recipient.id){
    io.to(socketId).emit("privateMessage",payload);
  }
}
});

socket.on("join",room=>{
const user=utilisateurs.get(socket.id);
if(!user||!salons.includes(room))return;
socket.leave(user.room);
user.room=room;
socket.join(room);
});

socket.on("message",data=>{
const user=utilisateurs.get(socket.id);
if(!user||!data||typeof data.message!=="string")return;
const message=data.message.trim().slice(0,1000);
if(!message)return;

const check = checkMessage(user.id, message);

if(!check.allowed){
  socket.emit("privateError", check.reason);
  return;
}

io.to(user.room).emit("message",{
pseudo:user.pseudo,
room:user.room,
message
});
});

socket.on("disconnect",()=>{
utilisateurs.delete(socket.id);
updateMembers();
});
});

server.listen(process.env.PORT || 3001,"0.0.0.0",()=>{
console.log("ATLASCOM V2 disponible sur http://127.0.0.1:3000");
});
