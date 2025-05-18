import {Telegraf} from 'telegraf';
import db from './db.js';
import {v4 as uuidv4} from 'uuid';

const token = 'BOTTOKEN';
const bot = new Telegraf(token);
const admins = [966402438];

// In-memory storage for active games
const games = {};

// Game states
const GAME_STATES = {
    WAITING: 'waiting',
    BETTING_ROUND_1: 'betting_round_1',
    BETTING_ROUND_2: 'betting_round_2',
    BETTING_ROUND_3: 'betting_round_3',
    FINALIZING: 'finalizing'
};

// Функция для получения метки раунда в Markdown
function getRoundLabel(state) {
    switch (state) {
        case GAME_STATES.BETTING_ROUND_1:
            return '1️⃣ 𝑭𝑰𝑹𝑺𝑻 𝑹𝑶𝑼𝑵𝑫 1️⃣'
        case GAME_STATES.BETTING_ROUND_2:
            return '2️⃣ 𝑺𝑬𝑪𝑶𝑵𝑫 𝑹𝑶𝑼𝑵𝑫 2️⃣';
        case GAME_STATES.BETTING_ROUND_3:
            return '🏁 𝑳𝑨𝑺𝑻 𝑹𝑶𝑼𝑵𝑫 🏁';
        default:
            return '';
    }
}
bot.start((ctx) => {
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    const userId = ctx.from.id;

    db.run(
        'INSERT OR IGNORE INTO users (id, username, balance) VALUES (?, ?, ?)',
        [userId, userName, 100],
        (err) => {
            if (err) {
                console.error('DB insert error:', err.message);
            }
        }
    );

    ctx.reply('Выберите действие:', {
        reply_markup: {
            keyboard: [
                [{ text: '💰 Мой баланс 💰' }, { text: '🎮 Создать игру 🎮' }],
                [{ text: '🃏 Комбинации 🃏' }, { text: '🔍 Найти игру 🔍' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

bot.hears('💰 Мой баланс 💰', (ctx) => {
    const userId = ctx.from.id;

    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) {
            console.error('DB read error:', err.message);
            return ctx.reply('Ошибка при получении баланса.');
        }

        if (row) {
            ctx.reply(`Ваш баланс: ${row.balance} монет 🪙`);
        } else {
            ctx.reply('Пользователь не найден. Напишите /start');
        }
    });
});

bot.command('money', (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();
    const parts = messageText.split(' ');

    if (parts.length === 4 && parts[1] === 'edit') {
        if (!admins.includes(userId)) {
            return ctx.reply('❌ У вас нет прав использовать /money edit.');
        }

        const targetId = parseInt(parts[2]);
        const newBalance = parseInt(parts[3]);

        if (isNaN(targetId) || isNaN(newBalance)) {
            return ctx.reply('❌ Неверный формат. Используйте: /money edit <id> <баланс>');
        }

        db.run(
            'UPDATE users SET balance = ? WHERE id = ?',
            [newBalance, targetId],
            function (err) {
                if (err) {
                    console.error('DB update error:', err.message);
                    return ctx.reply('❌ Ошибка при обновлении баланса.');
                }

                if (this.changes === 0) {
                    ctx.reply('❌ Пользователь с таким ID не найден.');
                } else {
                    ctx.reply(`✅ Баланс пользователя ${targetId} изменён на ${newBalance} монет.`);
                }
            }
        );
    } else {
        db.all('SELECT id, username, balance FROM users', (err, rows) => {
            if (err) {
                console.error('DB read error:', err.message);
                return ctx.reply('❌ Ошибка при получении данных.');
            }

            if (rows.length === 0) {
                return ctx.reply('📭 Нет зарегистрированных пользователей.');
            }

            const message = rows
                .map(u => `👤 ID: ${u.id}, @${u.username || 'Без имени'} — 💰 ${u.balance} монет`)
                .join('\n');
            ctx.reply(`📊 Балансы всех пользователей:\n\n${message}`);
        });
    }
});

bot.hears('🃏 Комбинации 🃏', (ctx) => {
    ctx.replyWithMediaGroup([
        {
            type: 'photo',
            media: 'https://i.pinimg.com/originals/f8/30/68/f83068bda5d75dfbee9031dcc9ad0a4a.jpg'
        }
    ]);
});

bot.hears('🎮 Создать игру 🎮', (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    const gameId = uuidv4();

    games[gameId] = {
        state: GAME_STATES.WAITING,
        dealer: { id: userId, username: userName },
        players: [{ id: userId, username: userName, bet: 0, folded: false }],
        pot: 0,
        currentBet: 0,
        currentPlayerIndex: 0,
        round: 1
    };

    ctx.reply(`🎲 Игра создана! ID игры: ${gameId}\nВы являетесь дилером.\nОжидаем игроков...`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Начать игру', callback_data: `start_game_${gameId}` }],
                [{ text: 'Отменить игру', callback_data: `cancel_game_${gameId}` }]
            ]
        }
    });
});

bot.hears('🔍 Найти игру 🔍', (ctx) => {
    const activeGames = Object.keys(games).filter(id => games[id].state === GAME_STATES.WAITING);
    if (activeGames.length === 0) {
        return ctx.reply('Нет доступных игр.');
    }

    const buttons = activeGames.map(id => [{
        text: `Игра ${id.slice(0, 8)}... (Дилер: @${games[id].dealer.username})`,
        callback_data: `join_game_${id}`
    }]);

    ctx.reply('Доступные игры:', {
        reply_markup: {
            inline_keyboard: buttons
        }
    });
});

bot.action(/join_game_(.+)/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

    if (!games[gameId] || games[gameId].state !== GAME_STATES.WAITING) {
        return ctx.reply('Игра не найдена или уже началась.');
    }

    if (games[gameId].players.some(p => p.id === userId)) {
        return ctx.reply('Вы уже в этой игре.');
    }

    games[gameId].players.push({ id: userId, username: userName, bet: 0, folded: false });

    ctx.reply(`Вы присоединились к игре ${gameId}! Ожидаем начала...`);
    bot.telegram.sendMessage(
        games[gameId].dealer.id,
        `Игрок @${userName} присоединился к игре ${gameId}.`
    );
});

bot.action(/start_game_(.+)/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;

    if (!games[gameId] || games[gameId].dealer.id !== userId) {
        return ctx.reply('Вы не можете начать эту игру.');
    }

    if (games[gameId].players.length < 2) {
        return ctx.reply('Нужно минимум 2 игрока для начала игры.');
    }

    games[gameId].state = GAME_STATES.BETTING_ROUND_1;
    notifyCurrentPlayer(gameId, ctx);
});

bot.action(/cancel_game_(.+)/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;

    if (!games[gameId] || games[gameId].dealer.id !== userId) {
        return ctx.reply('Вы не можете отменить эту игру.');
    }

    games[gameId].players.forEach(player => {
        bot.telegram.sendMessage(player.id, `Игра ${gameId} была отменена дилером.`);
    });

    delete games[gameId];
    ctx.reply('Игра отменена.');
});

// Обработка ввода ставки
bot.hears(/^\d+$/, (ctx) => {
    const userId = ctx.from.id;
    const amount = parseInt(ctx.message.text);

    // Найти игру, где этот игрок сейчас ходит
    const gameId = Object.keys(games).find(id => {
        const game = games[id];
        return game.state !== GAME_STATES.WAITING &&
            game.state !== GAME_STATES.FINALIZING &&
            game.players[game.currentPlayerIndex].id === userId;
    });

    if (!gameId) {
        return ctx.reply('Сейчас не ваш ход или вы не в игре.');
    }

    const game = games[gameId];
    const player = game.players[game.currentPlayerIndex];
    const toCall = game.currentBet - player.bet;

    if (amount < toCall) {
        return ctx.reply(`Нужно поставить минимум ${toCall} монет, чтобы уравнять ставку.`);
    }

    if (amount <= 0) {
        return ctx.reply('Ставка должна быть больше 0.');
    }

    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, row) => {
        if (err || !row || row.balance < amount) {
            return ctx.reply('Недостаточно монет или ошибка.');
        }

        db.run(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [amount, userId],
            (err) => {
                if (err) {
                    console.error('DB update error:', err.message);
                    return ctx.reply('Ошибка при обновлении баланса.');
                }

                game.pot += amount;
                player.bet += amount;
                game.currentBet = Math.max(game.currentBet, player.bet);

                advanceTurn(gameId, ctx);
            }
        );
    });
});

bot.action(/check_(.+)/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;

    if (!games[gameId] || games[gameId].players[games[gameId].currentPlayerIndex].id !== userId) {
        return ctx.reply('Сейчас не ваш ход.');
    }

    const toCall = games[gameId].currentBet - games[gameId].players[games[gameId].currentPlayerIndex].bet;
    if (toCall > 0) {
        return ctx.reply('Вы не можете сделать чек, нужно уравнять ставку.');
    }

    advanceTurn(gameId, ctx);
});

bot.action(/fold_(.+)/, (ctx) => {
    const gameId = ctx.match[1];
    const userId = ctx.from.id;

    if (!games[gameId] || games[gameId].players[games[gameId].currentPlayerIndex].id !== userId) {
        return ctx.reply('Сейчас не ваш ход.');
    }

    games[gameId].players[games[gameId].currentPlayerIndex].folded = true;
    advanceTurn(gameId, ctx);
});

function advanceTurn(gameId, ctx) {
    const game = games[gameId];
    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

    // Check if all active players have matched the current bet or folded
    const activePlayers = game.players.filter(p => !p.folded);
    const allBetsEqual = activePlayers.every(p => p.bet === game.currentBet || p.folded);

    if (game.currentPlayerIndex === 0 && allBetsEqual && activePlayers.length > 1) {
        // Move to next round
        if (game.state === GAME_STATES.BETTING_ROUND_1) {
            game.state = GAME_STATES.BETTING_ROUND_2;
            game.currentBet = 0;
            game.players.forEach(p => p.bet = 0);
            notifyPlayers(gameId, 'Начался второй раунд ставок.');
        } else if (game.state === GAME_STATES.BETTING_ROUND_2) {
            game.state = GAME_STATES.BETTING_ROUND_3;
            game.currentBet = 0;
            game.players.forEach(p => p.bet = 0);
            notifyPlayers(gameId, 'Начался третий раунд ставок.');
        } else if (game.state === GAME_STATES.BETTING_ROUND_3) {
            game.state = GAME_STATES.FINALIZING;
            finalizeGame(gameId, ctx);
            return;
        }
    }

    // If only one player remains, end the game
    if (activePlayers.length === 1) {
        game.state = GAME_STATES.FINALIZING;
        finalizeGame(gameId, ctx);
        return;
    }

    notifyCurrentPlayer(gameId, ctx);
}

function notifyCurrentPlayer(gameId, ctx) {
    const game = games[gameId];
    const player = game.players[game.currentPlayerIndex];

    if (player.folded) {
        advanceTurn(gameId, ctx);
        return;
    }

    const toCall = game.currentBet - player.bet;
    const buttons = [[{ text: 'Сбросить', callback_data: `fold_${gameId}` }]];

    if (toCall === 0) {
        buttons.unshift([{ text: 'Чек', callback_data: `check_${gameId}` }]);
    }

    bot.telegram.sendMessage(
        player.id,
        `${getRoundLabel(game.state)}\n\n` +
        `Ваш ход в игре.\n` +
        `Текущая ставка: ${game.currentBet} монет.\n` +
        `Ваш текущий взнос: ${player.bet} монет.\n` +
        `Банк: ${game.pot} монет.\n` +
        (toCall > 0
            ? `Введите сумму ставки (минимум ${toCall} монет для уравнивания).`
            : `Введите сумму ставки или выберите Чек.`),
        {
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );
}

function notifyPlayers(gameId, message) {
    const game = games[gameId];
    game.players.forEach(player => {
        if (!player.folded) {
            bot.telegram.sendMessage(player.id, message);
        }
    });
}

function finalizeGame(gameId, ctx) {
    const game = games[gameId];
    const activePlayers = game.players.filter(p => !p.folded);

    if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        db.run(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [game.pot, winner.id],
            (err) => {
                if (err) {
                    console.error('DB update error:', err.message);
                }
                notifyPlayers(gameId, `Игра ${gameId} завершена. Победитель: @${winner.username} получает ${game.pot} монет!`);
                delete games[gameId];
            }
        );
    } else {
        const buttons = game.players
            .filter(p => !p.folded)
            .map(p => [{ text: `@${p.username}`, callback_data: `winner_${gameId}_${p.id}` }]);

        bot.telegram.sendMessage(
            game.dealer.id,
            `Игра ${gameId} завершена. Выберите победителя:`,
            {
                reply_markup: {
                    inline_keyboard: buttons
                }
            }
        );
    }
}

bot.action(/winner_(.+)_(\d+)/, (ctx) => {
    const gameId = ctx.match[1];
    const winnerId = parseInt(ctx.match[2]);
    const userId = ctx.from.id;

    if (!games[gameId] || games[gameId].dealer.id !== userId) {
        return ctx.reply('Вы не можете выбрать победителя.');
    }

    const winner = games[gameId].players.find(p => p.id === winnerId);
    if (!winner || winner.folded) {
        return ctx.reply('Недопустимый победитель.');
    }

    db.run(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [games[gameId].pot, winnerId],
        (err) => {
            if (err) {
                console.error('DB update error:', err.message);
                return ctx.reply('Ошибка при начислении выигрыша.');
            }

            notifyPlayers(gameId, `Игра ${gameId} завершена. Победитель: @${winner.username} получает ${games[gameId].pot} монет!`);
            delete games[gameId];
        }
    );
});

// Запуск бота
bot.launch()
    .then(() => console.log('Bot is running...'))
    .catch((err) => console.error('Bot launch failed:', err));