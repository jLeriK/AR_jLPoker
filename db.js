import sqlite3 from 'sqlite3';
sqlite3.verbose();

const db = new sqlite3.Database('users.db');

// Создание таблицы при первом запуске
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0
    )`);
});

export default db;
