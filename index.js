// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const uuid = require('uuid');
const client = require('./services/coinpaymentsClient');
const { verifyIPN } = require('./coinpayments_ipn');
const DB = require('./db'); // object with helpers
const { startAutoUpdater } = require('./services/rates');

const {
  getUserByTelegramId, createUser, getLatestRate,
  upsertRate, addDeposit, setDepositStatus, creditUser, getUserByReferralCode,
  addReferralReward, recordWithdrawal, getUserById
} = DB;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN missing in .env');
  process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

const app = express();
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));

const ADMINS = (process.env.ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);

const REFERRAL_REWARD = parseFloat(process.env.REFERRAL_REWARD || '1.5');
const REFERRAL_PAYOUT_THRESHOLD = parseFloat(process.env.REFERRAL_PAYOUT_THRESHOLD || '50');
const MIN_USDT = parseFloat(process.env.MIN_USDT || '25');
const MAX_USDT = parseFloat(process.env.MAX_USDT || '50000');

const initialRates = {
  usd: parseFloat(process.env.RATE_USD || '1.05'),
  eur: parseFloat(process.env.RATE_EUR || '0.89'),
  gbp: parseFloat(process.env.RATE_GBP || '0.79'),
};

startAutoUpdater(initialRates);

// helpers
function genReferralCode() {
  return uuid.v4().split('-')[0];
}

async function ensureUser(msg, startParam = null) {
  const tgId = msg.from.id;
  let user = getUserByTelegramId(tgId);
  if (!user) {
    const code = genReferralCode();
    let referred_by = null;
    if (startParam) {
      // startParam could be a referral code
      const ref = getUserByReferralCode(startParam);
      if (ref) {
        referred_by = startParam;
        // reward referrer immediately? we'll credit reward when referred user registers
        addReferralReward(null, startParam, 0); // no-op but placeholder
      }
    }
    createUser(tgId, msg.from.username || '', msg.from.first_name || '', msg.from.last_name || '', code, referred_by);
    user = getUserByTelegramId(tgId);
    // if referred_by exists, credit reward to referrer
    if (referred_by) {
      addReferralReward(user.id, referred_by, REFERRAL_REWARD);
    }
  }
  return user;
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Deposit USDT', callback_data: 'deposit' }, { text: 'Sell USDT', callback_data: 'sell' }],
        [{ text: 'Withdraw (fiat)', callback_data: 'withdraw' }],
        [{ text: 'Balance', callback_data: 'balance' }, { text: 'Referral', callback_data: 'referral' }]
      ]
    }
  };
}

// start handler
bot.onText(/\/start(?:\s(.+))?/, async (msg, match) => {
  const startParam = match && match[1] ? match[1] : null;
  await ensureUser(msg, startParam);
  const name = msg.from.first_name || 'there';
  bot.sendMessage(msg.chat.id, `Hello ${name}! Welcome to USDT→Fiat bot.\nUse the menu below.`, mainMenu());
});

// inline handler
bot.on('callback_query', async (q) => {
  const data = q.data;
  const chatId = q.message.chat.id;
  const user = getUserByTelegramId(q.from.id);
  if (!user) {
    await ensureUser(q);
  }
  if (data === 'deposit') {
    // show networks and amount prompt
    bot.sendMessage(chatId, `Choose network:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'TRC20 (TRX)', callback_data: 'deposit_net_trc' }, { text: 'ERC20 (ETH)', callback_data: 'deposit_net_erc' }]
        ]
      }
    });
  } else if (data.startsWith('deposit_net_')) {
    const network = data.endsWith('trc') ? 'TRC20' : 'ERC20';
    bot.sendMessage(chatId, `Send your USDT to deposit.\nFirst, reply how much USDT you want to deposit (min ${MIN_USDT}, max ${MAX_USDT}):`);
    // next message handler will catch amount by checking a short-term memory — for simplicity, we ask the user to use /deposit <amount> <network>
    bot.sendMessage(chatId, `Quick command: \n/deposit <amount> ${network}\nExample: /deposit 100 ${network}`);
  } else if (data === 'sell') {
    bot.sendMessage(chatId, `Sell USDT to fiat. Enter amount (USDT):\n(min ${MIN_USDT} - max ${MAX_USDT})`);
    // user then types /sell <amount>
    bot.sendMessage(chatId, `Quick command:\n/sell <amount> <currency>\nCurrencies: USD EUR GBP\nExample: /sell 100 USD`);
  } else if (data === 'balance') {
    const fresh = getUserByTelegramId(q.from.id);
    bot.sendMessage(chatId, `Your balance: ${Number(fresh.balance_usdt).toFixed(4)} USDT`, mainMenu());
  } else if (data === 'referral') {
    const u = getUserByTelegramId(q.from.id);
    const link = `https://t.me/${(await bot.getMe()).username}?start=${u.referral_code}`;
    bot.sendMessage(chatId, `Your referral link:\n${link}\nEarn ${REFERRAL_REWARD} USDT per sign-up. Withdraw when referral earnings >= ${REFERRAL_PAYOUT_THRESHOLD} USDT.\nCurrent referral earned: ${u.referral_earned} USDT`, mainMenu());
  } else if (data === 'withdraw') {
    // start withdraw flow: ask amount
    bot.sendMessage(chatId, `Withdraw to fiat selected. Please enter amount in USDT (you will receive equivalent in selected fiat after choosing method). Example: /withdraw 100`);
    bot.sendMessage(chatId, `Quick usage:\n/withdraw <amount>`);
  }
  // answer callback
  bot.answerCallbackQuery(q.id).catch(()=>{});
});

// text command handlers: deposit, sell, withdraw etc.
bot.onText(/\/deposit\s+([0-9]+(?:\.[0-9]+)?)\s*(TRC20|ERC20)?/i, async (msg, match) => {
  const amount = parseFloat(match[1]);
  const network = (match[2] || 'TRC20').toUpperCase();
  if (amount < MIN_USDT || amount > MAX_USDT) {
    return bot.sendMessage(msg.chat.id, `Amount must be between ${MIN_USDT} and ${MAX_USDT} USDT.`);
  }
  // create a CoinPayments simple transaction (create_transaction)
  try {
    const payload = {
      amount: amount,
      currency1: 'USDT',
      currency2: 'USDT',
      ipn_url: `${process.env.PUBLIC_URL || 'https://example.com'}/ipn`,
      // callback/custom field to identify user
      buyer_email: `${msg.from.id}@telegram` // convenient place to store user id
    };
    // For network selection, you can set 'address' parameter or use 'currency2' with network suffix if supported.
    // many gateways don't let you pick ERC/TRC via createTransaction; some require currency2 = 'USDTTRC' etc. Adjust per CoinPayments docs.
    const tx = await client.createTransaction(payload);
    // store deposit
    const user = getUserByTelegramId(msg.from.id);
    addDeposit(user.id, amount, network, tx.txn_id, 'pending');
    bot.sendMessage(msg.chat.id, `Deposit created!\nSend exactly ${tx.amount} ${tx.currency2} to:\n${tx.address}\n\nTransaction ID: ${tx.txn_id}\nStatus: pending\nWhen the payment is confirmed, your wallet will be credited.`);
  } catch (err) {
    console.error('createTransaction err', err);
    bot.sendMessage(msg.chat.id, `Error creating deposit. Please try again later or contact admin.`);
  }
});

// SELL command: convert USDT to fiat
bot.onText(/\/sell\s+([0-9]+(?:\.[0-9]+)?)\s*(USD|EUR|GBP)?/i, async (msg, match) => {
  const amount = parseFloat(match[1]);
  const currency = (match[2] || 'USD').toUpperCase();
  if (amount < MIN_USDT || amount > MAX_USDT) {
    return bot.sendMessage(msg.chat.id, `Amount must be between ${MIN_USDT} and ${MAX_USDT} USDT.`);
  }
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, `User not found. Use /start first.`);
  if (user.balance_usdt < amount) return bot.sendMessage(msg.chat.id, `Insufficient balance. Your balance: ${user.balance_usdt} USDT`);
  // get current rate
  const r = getLatestRate();
  const rateUsd = r ? r.usd : initialRates.usd;
  const rateEur = r ? r.eur : initialRates.eur;
  const rateGbp = r ? r.gbp : initialRates.gbp;
  let fiatAmount = 0;
  if (currency === 'USD') fiatAmount = amount * rateUsd;
  else if (currency === 'EUR') fiatAmount = amount * rateEur;
  else if (currency === 'GBP') fiatAmount = amount * rateGbp;
  fiatAmount = Number(fiatAmount.toFixed(2));
  // store a pending withdrawal and ask for payment method details
  // Save to DB: withdrawal pending and ask step-by-step
  // For simplicity, ask payment method now:
  bot.sendMessage(msg.chat.id, `You will receive approximately ${fiatAmount} ${currency} for ${amount} USDT.\nChoose payment method:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Wise', callback_data: `pm_Wise|${amount}|${currency}` }, { text: 'PayPal', callback_data: `pm_PayPal|${amount}|${currency}` }],
        [{ text: 'Revolut', callback_data: `pm_Revolut|${amount}|${currency}` }, { text: 'Bank Transfer', callback_data: `pm_Bank|${amount}|${currency}` }],
        [{ text: 'Alipay', callback_data: `pm_Alipay|${amount}|${currency}` }, { text: 'Card number', callback_data: `pm_Card|${amount}|${currency}` }],
        [{ text: 'Skrill', callback_data: `pm_Skrill|${amount}|${currency}` }, { text: 'Neteller', callback_data: `pm_Neteller|${amount}|${currency}` }, { text: 'Payeer', callback_data: `pm_Payeer|${amount}|${currency}` }]
      ]
    }
  });
});

// Callback for payment method selection during sell flow
bot.on('callback_query', async q => {
  if (!q.data) return;
  if (q.data.startsWith('pm_')) {
    const parts = q.data.split('|');
    const pm = parts[0].substring(3); // e.g. Wise
    const amount = parts[1];
    const currency = parts[2];
    const chatId = q.message.chat.id;
    // We now prompt for method-specific details
    let prompt = '';
    if (pm === 'Wise') prompt = 'Please provide your Wise tag or Wise email:';
    else if (pm === 'PayPal') prompt = 'Please provide your PayPal email:';
    else if (pm === 'Revolut') prompt = 'Please provide your Revolut Tag (RevTag) or email:';
    else if (pm === 'Bank') prompt = 'Is this a European or US bank? Reply "EU" or "US"';
    else if (pm === 'Alipay') prompt = 'Please provide your Alipay email:';
    else if (pm === 'Card') prompt = 'Please provide your card number:';
    else if (pm === 'Skrill') prompt = 'Please provide your Skrill email:';
    else if (pm === 'Neteller') prompt = 'Please provide your Neteller email:';
    else if (pm === 'Payeer') prompt = 'Please provide your Payeer number:';
    else prompt = 'Please provide required details:';
    // store temporary flow context - naive approach: ask user to reply with /paydetails <method> <amount> <currency> <details>
    bot.sendMessage(chatId, `${prompt}\n\nQuick usage after you have details:\n/paydetails ${pm} ${amount} ${currency} <your-details>\nExample: /paydetails Wise ${amount} ${currency} mywise@example.com`);
  }
  bot.answerCallbackQuery(q.id).catch(()=>{});
});

// handle /paydetails command to record withdrawal details and create pending withdrawal
bot.onText(/\/paydetails\s+(\S+)\s+([0-9]+(?:\.[0-9]+)?)\s+(USD|EUR|GBP)\s+(.+)/i, async (msg, match) => {
  const method = match[1];
  const amountUsdt = parseFloat(match[2]);
  const fiat = match[3];
  const details = match[4];
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, 'User not found. Use /start.');
  if (user.balance_usdt < amountUsdt) return bot.sendMessage(msg.chat.id, `Insufficient balance.`);
  // deduct from user immediately (or mark pending)
  DB.db.prepare('UPDATE users SET balance_usdt = balance_usdt - ? WHERE id = ?').run(amountUsdt, user.id);
  recordWithdrawal(user.id, amountUsdt, fiat, method, details);
  bot.sendMessage(msg.chat.id, `Withdrawal recorded and sent to admin for processing. Details:\nMethod: ${method}\nDetails: ${details}\nAmount: ${amountUsdt} USDT\nWe will process and confirm.`);
});

// Withdraw command quick entry
bot.onText(/\/withdraw\s+([0-9]+(?:\.[0-9]+)?)/i, async (msg, match) => {
  const amt = parseFloat(match[1]);
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, 'User not found. Use /start.');
  if (user.balance_usdt < amt) return bot.sendMessage(msg.chat.id, `Insufficient balance.`);
  bot.sendMessage(msg.chat.id, `Please choose fiat currency and method: use /sell <amount> <currency> or use the menu.`);
});

// Balance command
bot.onText(/\/balance/i, async (msg) => {
  const user = getUserByTelegramId(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, 'User not found. Use /start.');
  bot.sendMessage(msg.chat.id, `Balance: ${Number(user.balance_usdt).toFixed(4)} USDT`);
});

// Admin command
bot.onText(/\/admin(?:\s+(.+))?/, async (msg, match) => {
  const username = msg.from.username || '';
  if (!ADMINS.includes(username)) {
    return bot.sendMessage(msg.chat.id, `Access denied. Admins only.`);
  }
  const arg = match && match[1] ? match[1] : null;
  // Provide basic admin menu
  bot.sendMessage(msg.chat.id, `Admin menu:\nCommands:\n/admin rates USD EUR GBP  -> set rates\n/admin users -> list summary\n/admin deposits -> list recent deposits`);
});

// Admin set rates example
bot.onText(/\/admin\s+rates\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i, async (msg, match) => {
  const username = msg.from.username || '';
  if (!ADMINS.includes(username)) return bot.sendMessage(msg.chat.id, 'Access denied.');
  const usd = parseFloat(match[1]), eur = parseFloat(match[2]), gbp = parseFloat(match[3]);
  upsertRate(usd, eur, gbp);
  bot.sendMessage(msg.chat.id, `Rates updated: USD ${usd}, EUR ${eur}, GBP ${gbp}`);
});

// IPN endpoint for CoinPayments
app.post('/ipn', async (req, res) => {
  const privateKey = process.env.COINPAYMENTS_PRIVATE_KEY;
  if (!verifyIPN(req, privateKey)) {
    console.warn('Invalid IPN HMAC');
    return res.status(400).send('invalid');
  }
  const body = req.body;
  // coinpayments posts fields like txn_id, status, amount, currency1/currency2, buyer_email etc.
  const txnId = body.txn_id;
  const status = parseInt(body.status, 10); // status numeric, >=100 = complete
  console.log('IPN received', txnId, 'status', status);
  if (status >= 100 || status === 2) {
    // deposit confirmed
    // locate deposit by txnId
    DB.setDepositStatus(txnId, 'complete');
    // find deposits entry
    const dep = DB.db.prepare('SELECT * FROM deposits WHERE coinpayments_txn_id = ?').get(txnId);
    if (dep) {
      creditUser(dep.user_id, dep.amount_usdt);
      // notify user
      const u = getUserById(dep.user_id);
      if (u) {
        bot.sendMessage(u.telegram_id, `Deposit confirmed: ${dep.amount_usdt} USDT has been credited to your wallet.`);
      }
    }
  } else {
    DB.setDepositStatus(txnId, `status_${status}`);
  }
  res.status(200).send('OK');
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.log('Bot started.');
