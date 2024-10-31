const TelegramBot = require("node-telegram-bot-api");
const redis = require("redis");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

// Redis client setup
const redisClient = redis.createClient({ url: process.env.REDIS_URL });

redisClient.on("error", (err) => console.error("Redis Client Error", err));

(async () => {
  await redisClient.connect();
})();

const bot = new TelegramBot(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = `${process.env.BASE_URL}/bot${process.env.BOT_TOKEN}`;

// Set up webhook
bot.setWebHook(WEBHOOK_URL);
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Add to waiting list
async function addToWaitingList(chatId, gender) {
  const oppositeGender = gender === "male" ? "female" : "male";
  const partnerId = await redisClient.lPop(oppositeGender); // Try to find a partner in the opposite list

  if (partnerId) {
    // Start a chat with the partner
    startChat(chatId, partnerId);
  } else {
    // Add user to their gender's waiting list
    await redisClient.rPush(gender, chatId);
    bot.sendMessage(chatId, "Waiting for a partner...");
  }
}

// Start a chat between two users
async function startChat(user1, user2) {
  await redisClient.hSet("activeChats", user1, user2);
  await redisClient.hSet("activeChats", user2, user1);

  bot.sendMessage(user1, "You are now connected! Say hi 👋");
  bot.sendMessage(user2, "You are now connected! Say hi 👋");
}

// End the chat between two users
async function endChat(chatId) {
  const partnerId = await redisClient.hGet("activeChats", chatId);
  if (partnerId) {
    // Notify both users and remove from active chats
    bot.sendMessage(chatId, "Chat ended.");
    bot.sendMessage(partnerId, "Your partner has ended the chat.");

    await redisClient.hDel("activeChats", chatId);
    await redisClient.hDel("activeChats", partnerId);
  } else {
    bot.sendMessage(chatId, "You're not in an active chat.");
  }
}

// Commands and event handling
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "Welcome! Are you Male or Female? Type /male or /female to start."
  );
});

bot.onText(/\/male/, (msg) => {
  const chatId = msg.chat.id;
  addToWaitingList(chatId, "male");
});

bot.onText(/\/female/, (msg) => {
  const chatId = msg.chat.id;
  addToWaitingList(chatId, "female");
});

// Forward messages between active chat partners
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const partnerId = await redisClient.hGet("activeChats", chatId);

  if (partnerId) {
    bot.sendMessage(partnerId, msg.text);
  }
});

// End chat command
bot.onText(/\/end/, async (msg) => {
  const chatId = msg.chat.id;
  endChat(chatId);
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
