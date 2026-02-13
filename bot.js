require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const holidays = require('./holidays_ru');

// Настройки из .env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CLOUD_API_TOKEN = process.env.CLOUD_API_TOKEN;
const SERVER_ID = process.env.SERVER_ID;
const ALLOWED_GROUP_ID = parseInt(process.env.ALLOWED_GROUP_ID);

// Файлы конфигурации
const DECISIONS_FILE = path.join(__dirname, 'holiday_decisions.json');
const SCHEDULE_FILE = path.join(__dirname, 'schedule_config.json');

// API endpoints
const CLOUD_API_BASE = 'https://api.1cloud.ru';

// Загрузка расписания из файла
function loadSchedule() {
    try {
        if (fs.existsSync(SCHEDULE_FILE)) {
            return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
        }
    } catch (e) {
        log(`Ошибка загрузки расписания: ${e.message}`);
    }
    // Значения по умолчанию
    return {
        workDays: [1, 2, 3, 4, 5],
        workDaysNames: ["Пн", "Вт", "Ср", "Чт", "Пт"],
        startHour: 8,
        endHour: 18,
        serverStartMinutesBefore: 5
    };
}

// Сохранение расписания
function saveSchedule(schedule) {
    schedule.lastUpdated = new Date().toISOString();
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
    log(`Расписание сохранено: ${JSON.stringify(schedule)}`);
    
    // Обновляем cron после изменения расписания
    updateCronJobs(schedule);
}

// Обновление cron заданий
function updateCronJobs(schedule) {
    const { exec } = require('child_process');
    
    // Формируем время запуска (за N минут до начала)
    let startMinute = 60 - schedule.serverStartMinutesBefore;
    let startHour = schedule.startHour - 1;
    if (startMinute >= 60) {
        startMinute = startMinute - 60;
        startHour = schedule.startHour;
    }
    
    // Формируем дни недели для cron (0=Вс, 1=Пн, ...)
    const cronDays = schedule.workDays.join(',');
    
    // Время остановки (через 5 минут после окончания)
    const stopMinute = 5;
    const stopHour = schedule.endHour;
    
    const cronCommands = `
# Удаляем старые задания парсера
(crontab -l 2>/dev/null | grep -v "1cloudbot") | crontab -

# Добавляем новые
(crontab -l 2>/dev/null; echo "${startMinute} ${startHour} * * ${cronDays} cd /root/1cloudbot && /usr/bin/node bot.js --check-start >> /root/1cloudbot/logs/cron.log 2>&1") | crontab -
(crontab -l 2>/dev/null; echo "${stopMinute} ${stopHour} * * ${cronDays} cd /root/1cloudbot && /usr/bin/node bot.js --check-stop >> /root/1cloudbot/logs/cron.log 2>&1") | crontab -
`;
    
    exec(cronCommands, (error, stdout, stderr) => {
        if (error) {
            log(`Ошибка обновления cron: ${error.message}`);
        } else {
            log(`✅ Cron обновлён: запуск ${startHour}:${startMinute.toString().padStart(2,'0')}, стоп ${stopHour}:${stopMinute.toString().padStart(2,'0')}, дни: ${cronDays}`);
        }
    });
}

// Получить расписание (кэшированное)
let cachedSchedule = null;
function getSchedule() {
    if (!cachedSchedule) {
        cachedSchedule = loadSchedule();
    }
    return cachedSchedule;
}

// Сбросить кэш расписания
function resetScheduleCache() {
    cachedSchedule = null;
}

// Создаем бота
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ============================================================================
// УТИЛИТЫ
// ============================================================================

function log(message) {
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    console.log(`[${timestamp}] ${message}`);
}

// Загрузка решений по праздникам
function loadDecisions() {
    try {
        if (fs.existsSync(DECISIONS_FILE)) {
            return JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8'));
        }
    } catch (e) {
        log(`Ошибка загрузки решений: ${e.message}`);
    }
    return {};
}

// Сохранение решений по праздникам
function saveDecision(dateKey, decision) {
    const decisions = loadDecisions();
    decisions[dateKey] = {
        decision: decision,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2));
    log(`Сохранено решение для ${dateKey}: ${decision}`);
}

// Получение решения для даты
function getDecision(dateKey) {
    const decisions = loadDecisions();
    return decisions[dateKey] || null;
}

// Получить текущую дату в московском времени
function getMoscowDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

// Получить ключ даты для хранения решений
function getDateKey(date) {
    return date.toISOString().split('T')[0];
}

// ============================================================================
// 1CLOUD API
// ============================================================================

async function serverAction(action) {
    try {
        const response = await axios.post(
            `${CLOUD_API_BASE}/server/${SERVER_ID}/action`,
            { Type: action },
            {
                headers: {
                    'Authorization': `Bearer ${CLOUD_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return { success: true, data: response.data };
    } catch (error) {
        log(`Ошибка при выполнении действия ${action}: ${error.response?.data || error.message}`);
        return { success: false, error: error.response?.data?.Message || error.message };
    }
}

async function getServerStatus() {
    try {
        const response = await axios.get(
            `${CLOUD_API_BASE}/server/${SERVER_ID}`,
            { headers: { 'Authorization': `Bearer ${CLOUD_API_TOKEN}` } }
        );
        return { success: true, data: response.data };
    } catch (error) {
        log(`Ошибка при получении статуса: ${error.response?.data || error.message}`);
        return { success: false, error: error.response?.data?.Message || error.message };
    }
}

async function powerOnServer() {
    return await serverAction('PowerOn');
}

async function powerOffServer() {
    return await serverAction('ShutDownGuestOS');
}

// ============================================================================
// ЛОГИКА ПРАЗДНИКОВ И РАСПИСАНИЯ
// ============================================================================

async function checkAndStartParser() {
    const now = getMoscowDate();
    const dayInfo = holidays.getDayInfo(now);
    const dateKey = getDateKey(now);
    
    log('=== Проверка запуска парсера ===');
    log(`Дата: ${dayInfo.dateString}`);
    log(`Праздник: ${dayInfo.isHoliday ? dayInfo.holidayName : 'Нет'}`);
    log(`Выходной: ${dayInfo.isWeekend ? 'Да' : 'Нет'}`);
    log(`Рабочий день по расписанию: ${dayInfo.isWorkingDay ? 'Да' : 'Нет'}`);
    
    // Если выходной (Сб/Вс) - не запускаем
    if (dayInfo.isWeekend) {
        log('❌ Выходной день - парсер не запускается');
        return { action: 'skip', reason: 'weekend' };
    }
    
    // Проверяем рабочий день по нашему расписанию (не по holidays_ru)
    const schedule = getSchedule();
    const dayOfWeek = now.getDay(); // 0=Вс, 1=Пн, ...
    const isScheduledWorkDay = schedule.workDays.includes(dayOfWeek);
    
    if (!isScheduledWorkDay) {
        log(`❌ День ${dayOfWeek} не входит в рабочие дни ${schedule.workDays} - парсер не запускается`);
        return { action: 'skip', reason: 'not_working_day' };
    }
    
    // Если праздник в рабочий день по нашему расписанию - проверяем решение или спрашиваем
    const isHolidayOnWorkDay = dayInfo.isHoliday && !dayInfo.isWeekend && isScheduledWorkDay;
    
    if (isHolidayOnWorkDay) {
        const existingDecision = getDecision(dateKey);
        
        if (existingDecision) {
            log(`Найдено существующее решение: ${existingDecision.decision}`);
            if (existingDecision.decision === 'yes') {
                return await startServerIfNeeded();
            } else {
                log('❌ Пользователь решил не запускать парсер в праздник');
                return { action: 'skip', reason: 'user_declined_holiday' };
            }
        }
        
        // Нужно спросить пользователя
        log('⚠️ Праздничный день - требуется подтверждение пользователя');
        await askHolidayConfirmation(dayInfo);
        return { action: 'waiting_confirmation', reason: 'holiday_confirmation_needed' };
    }
    
    // Обычный рабочий день - запускаем
    return await startServerIfNeeded();
}

async function startServerIfNeeded() {
    const { exec } = require('child_process');
    log('✅ Запускаем сервер парсера...');
    
    const status = await getServerStatus();
    if (status.success && status.data.IsPowerOn) {
        log('ℹ️ Сервер уже включен');
        return { action: 'already_running', reason: 'server_already_on' };
    }
    
    const result = await powerOnServer();
    if (result.success) {
        log('✅ Команда включения отправлена');
        
        // Уведомляем в группу
        const schInfo = getSchedule();
        await bot.sendMessage(ALLOWED_GROUP_ID,
            '🟢 *Парсер ATI запущен автоматически*\n\n' +
            `📅 ${getMoscowDate().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
            `⏰ Время работы: ${String(schInfo.startHour).padStart(2,'0')}:00 - ${String(schInfo.endHour).padStart(2,'0')}:00\n\n` +
            '⏳ Ожидание загрузки Windows...',
            { parse_mode: 'Markdown' }
        );
        
        // Ждём 60 секунд загрузки Windows
        log('⏳ Ожидание загрузки Windows (60 сек)...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        
        // Запускаем RDP подключение для создания сессии CloudAdmin
        log('🔌 Запуск RDP подключения...');
        exec('/root/1cloudbot/rdp_connect.sh', (error, stdout, stderr) => {
            if (error) {
                log(`⚠️ Ошибка RDP: ${error.message}`);
            } else {
                log('✅ RDP подключение выполнено');
            }
        });
        
        // Ждём ещё 15 секунд для RDP подключения и запуска Chrome
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        await bot.sendMessage(ALLOWED_GROUP_ID,
            '✅ *RDP сессия создана*\n\n' +
            'Chrome запускается автоматически с расширением парсера.',
            { parse_mode: 'Markdown' }
        );
        
        return { action: 'started', reason: 'server_powered_on_rdp_connected' };
    } else {
        log(`❌ Ошибка запуска: ${result.error}`);
        return { action: 'error', reason: result.error };
    }
}
async function askHolidayConfirmation(dayInfo) {
    const dateKey = getDateKey(getMoscowDate());
    
    const message = await bot.sendMessage(ALLOWED_GROUP_ID,
        '🎄 *Внимание! Сегодня праздничный день*\n\n' +
        `📅 ${dayInfo.dateString}\n` +
        `🎉 Праздник: *${dayInfo.holidayName}*\n\n` +
        'Это рабочий день по календарю, но праздник.\n' +
        'Запустить парсер ATI сегодня?\n\n' +
        '_Решение сохранится на весь день._',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Да, запустить', callback_data: `holiday_yes_${dateKey}` },
                        { text: '❌ Нет, выходной', callback_data: `holiday_no_${dateKey}` }
                    ]
                ]
            }
        }
    );
    
    log(`Отправлен запрос подтверждения праздника в группу`);
}

async function checkAndStopParser() {
    const now = getMoscowDate();
    const hour = now.getHours();
    const schedule = getSchedule();
    
    // Выключаем после окончания рабочего времени
    if (hour >= schedule.endHour) {
        log('=== Проверка выключения парсера (конец рабочего дня) ===');
        
        const status = await getServerStatus();
        if (status.success && status.data.IsPowerOn) {
            log('🔴 Рабочий день закончен, выключаем сервер...');
            
            const result = await powerOffServer();
            if (result.success) {
                await bot.sendMessage(ALLOWED_GROUP_ID,
                    '🔴 *Парсер ATI остановлен автоматически*\n\n' +
                    '⏰ Рабочий день завершён (18:00)\n' +
                    'Сервер выключается.',
                    { parse_mode: 'Markdown' }
                );
                log('✅ Команда выключения отправлена');
            }
        } else {
            log('ℹ️ Сервер уже выключен');
        }
    }
}

// ============================================================================
// TELEGRAM БОТ - ОБРАБОТЧИКИ
// ============================================================================

// Inline клавиатура управления
const getKeyboard = () => ({
    inline_keyboard: [
        [
            { text: '🟢 Включить сервер', callback_data: 'power_on' },
            { text: '🔴 Выключить сервер', callback_data: 'power_off' }
        ],
        [
            { text: '🔄 Перезагрузка', callback_data: 'reboot' },
            { text: '📊 Статус сервера', callback_data: 'status' }
        ],
        [
            { text: '📅 Праздники', callback_data: 'holidays' },
            { text: '⚙️ Расписание', callback_data: 'schedule' }
        ]
    ]
});

// Проверка доступа
function checkAccess(msg) {
    const chatId = msg.chat?.id || msg.message?.chat?.id;
    return chatId === ALLOWED_GROUP_ID;
}

// Функция ожидания изменения статуса
async function waitForPowerStatus(expectedStatus, chatId, messageId, actionName) {
    const maxWaitTime = 300000;
    const checkInterval = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        const statusResult = await getServerStatus();

        if (statusResult.success && statusResult.data.IsPowerOn === expectedStatus) {
            const waitTime = Math.round((Date.now() - startTime) / 1000);
            const finalText = expectedStatus 
                ? `✅ Сервер успешно включен!\n\n🔋 Питание: Включено\n📍 IP: ${statusResult.data.IP}\n⏱ Время: ${waitTime} сек`
                : `✅ Сервер успешно выключен!\n\n🔋 Питание: Выключено\n⏱ Время: ${waitTime} сек`;

            await bot.editMessageText(finalText, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: getKeyboard()
            });
            return true;
        }
        
        try {
            const dots = '.'.repeat((Math.floor((Date.now() - startTime) / checkInterval) % 3) + 1);
            await bot.editMessageText(
                `⏳ ${actionName}${dots}\n\nОжидаю изменения статуса...`,
                { chat_id: chatId, message_id: messageId }
            );
        } catch (e) {}
    }

    await bot.editMessageText(
        `⚠️ Таймаут ожидания. Проверьте статус вручную.`,
        { chat_id: chatId, message_id: messageId, reply_markup: getKeyboard() }
    );
    return false;
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    if (!checkAccess(msg)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещен');
        return;
    }

    const startSch = getSchedule();
    const autoStartH = startSch.startHour - 1;
    const autoStartM = 60 - startSch.serverStartMinutesBefore;
    await bot.sendMessage(msg.chat.id,
        '👋 *Бот управления сервером парсера ATI*\n\n' +
        '🎛 Управление сервером:\n' +
        '• 🟢 Включить / 🔴 Выключить\n' +
        '• 🔄 Перезагрузка / 📊 Статус\n\n' +
        '📅 *Автоматический режим:*\n' +
        `• Запуск: ${String(autoStartH).padStart(2,'0')}:${String(autoStartM).padStart(2,'0')} (${startSch.workDaysNames.join(', ')})\n` +
        `• Остановка: ${String(startSch.endHour).padStart(2,'0')}:00\n` +
        '• Праздники РФ учитываются\n\n' +
        '💡 В праздничные дни бот спросит подтверждение.\n\n' +
        '*Команды:* /schedule /settime /setdays /holidays',
        { parse_mode: 'Markdown', reply_markup: getKeyboard() }
    );
});

// Команда /schedule - показать и изменить расписание
bot.onText(/\/schedule$/, async (msg) => {
    if (!checkAccess(msg)) return;
    
    const schedule = getSchedule();
    const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const workDaysStr = schedule.workDays.map(d => daysNames[d]).join(', ');
    
    await bot.sendMessage(msg.chat.id,
        '⚙️ *Текущее расписание парсера:*\n\n' +
        `📆 Рабочие дни: ${workDaysStr}\n` +
        `⏰ Время работы: ${schedule.startHour}:00 - ${schedule.endHour}:00\n` +
        `🚀 Запуск сервера: за ${schedule.serverStartMinutesBefore} мин до начала\n\n` +
        '*Команды изменения:*\n' +
        '`/settime 9 20` - установить время 09:00-20:00\n' +
        '`/setdays 1,2,3,4,5` - установить дни (1=Пн)\n\n' +
        '⚠️ _После изменения обновите настройки в расширении Chrome!_',
        { parse_mode: 'Markdown' }
    );
});

// Команда /settime - установить время работы
bot.onText(/\/settime (\d+) (\d+)/, async (msg, match) => {
    if (!checkAccess(msg)) return;
    
    const startHour = parseInt(match[1]);
    const endHour = parseInt(match[2]);
    
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        await bot.sendMessage(msg.chat.id, '❌ Часы должны быть от 0 до 23');
        return;
    }
    
    if (startHour >= endHour) {
        await bot.sendMessage(msg.chat.id, '❌ Время начала должно быть меньше времени окончания');
        return;
    }
    
    const schedule = getSchedule();
    schedule.startHour = startHour;
    schedule.endHour = endHour;
    schedule.updatedBy = msg.from.username || msg.from.id;
    saveSchedule(schedule);
    resetScheduleCache();
    
    await bot.sendMessage(msg.chat.id,
        `✅ *Время работы обновлено!*\n\n` +
        `⏰ Новое расписание: ${startHour}:00 - ${endHour}:00\n` +
        `🚀 Сервер будет запускаться в ${startHour - 1}:${60 - schedule.serverStartMinutesBefore}\n\n` +
        '⚠️ _Не забудьте обновить время в расширении Chrome!_',
        { parse_mode: 'Markdown' }
    );
});

// Команда /setdays - установить рабочие дни
bot.onText(/\/setdays (.+)/, async (msg, match) => {
    if (!checkAccess(msg)) return;
    
    const daysStr = match[1];
    const days = daysStr.split(',').map(d => parseInt(d.trim())).filter(d => d >= 0 && d <= 6);
    
    if (days.length === 0) {
        await bot.sendMessage(msg.chat.id, 
            '❌ Неверный формат. Используйте числа 0-6:\n' +
            '0=Вс, 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт, 6=Сб\n\n' +
            'Пример: `/setdays 1,2,3,4,5` для Пн-Пт',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const schedule = getSchedule();
    schedule.workDays = days.sort();
    schedule.workDaysNames = days.map(d => daysNames[d]);
    schedule.updatedBy = msg.from.username || msg.from.id;
    saveSchedule(schedule);
    resetScheduleCache();
    
    await bot.sendMessage(msg.chat.id,
        `✅ *Рабочие дни обновлены!*\n\n` +
        `📆 Новые дни: ${schedule.workDaysNames.join(', ')}\n\n` +
        '⚠️ _Не забудьте обновить дни в расширении Chrome!_',
        { parse_mode: 'Markdown' }
    );
});

// Команда /holidays - показать праздники на текущий и следующий месяц
bot.onText(/\/holidays/, async (msg) => {
    if (!checkAccess(msg)) return;
    
    const now = getMoscowDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Получаем праздники на 2 месяца вперёд
    const upcoming = holidays.getUpcomingHolidays(62);
    
    if (upcoming.length === 0) {
        await bot.sendMessage(msg.chat.id, '📅 Праздников не найдено');
        return;
    }
    
    // Группируем по месяцам
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    
    const byMonth = {};
    for (const h of upcoming) {
        // Парсим дату из строки DD.MM.YYYY
        const parts = h.date.split('.');
        const monthKey = `${parts[2]}-${parts[1]}`; // YYYY-MM
        const monthNum = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        
        if (!byMonth[monthKey]) {
            byMonth[monthKey] = {
                name: `${monthNames[monthNum]} ${year}`,
                holidays: []
            };
        }
        byMonth[monthKey].holidays.push(h);
    }
    
    let text = '📅 *Праздники РФ*\n';
    
    for (const [key, month] of Object.entries(byMonth)) {
        text += `\n*${month.name}:*\n`;
        for (const h of month.holidays) {
            // 🔴 = официальный выходной в будний день (требует подтверждения)
            // 🔵 = выходной (Сб/Вс)
            // ⚪ = памятная дата
            let icon = '⚪';
            if (h.isPublicHoliday) {
                icon = h.isWeekend ? '🔵' : '🔴';
            }
            text += `${icon} ${h.date.substring(0, 5)} - ${h.name}\n`;
        }
    }
    
    text += '\n🔴 - выходной в будни (спросит)\n🔵 - выходной (Сб/Вс)\n⚪ - памятная дата';
    
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// Команда /check - ручная проверка запуска
bot.onText(/\/check/, async (msg) => {
    if (!checkAccess(msg)) return;
    
    const statusMsg = await bot.sendMessage(msg.chat.id, '⏳ Проверяю статус и расписание...');
    
    const dayInfo = holidays.getDayInfo(getMoscowDate());
    const serverStatus = await getServerStatus();
    
    let text = '📊 *Текущий статус:*\n\n';
    text += `📅 ${dayInfo.dateString}\n`;
    text += `🎉 Праздник: ${dayInfo.isHoliday ? dayInfo.holidayName : 'Нет'}\n`;
    text += `📆 Рабочий день: ${dayInfo.isWorkingDay && !dayInfo.isWeekend ? 'Да' : 'Нет'}\n\n`;
    
    if (serverStatus.success) {
        text += `🖥 Сервер: ${serverStatus.data.IsPowerOn ? '✅ Включен' : '❌ Выключен'}\n`;
        text += `📍 IP: ${serverStatus.data.IP}\n`;
    }
    
    await bot.editMessageText(text, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: getKeyboard()
    });
});

// Обработка callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const data = callbackQuery.data;

    if (!checkAccess(callbackQuery)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Доступ запрещен', show_alert: true });
        return;
    }

    bot.answerCallbackQuery(callbackQuery.id);

    // Обработка решения по праздникам
    if (data.startsWith('holiday_yes_')) {
        const dateKey = data.replace('holiday_yes_', '');
        saveDecision(dateKey, 'yes');
        
        await bot.editMessageText(
            '✅ *Решение принято: ЗАПУСТИТЬ парсер*\n\n' +
            'Сервер будет включен.',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
        
        await startServerIfNeeded();
        return;
    }
    
    if (data.startsWith('holiday_no_')) {
        const dateKey = data.replace('holiday_no_', '');
        saveDecision(dateKey, 'no');
        
        await bot.editMessageText(
            '❌ *Решение принято: НЕ запускать парсер*\n\n' +
            'Сегодня праздничный выходной.',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
        return;
    }

    // Стандартные действия
    let action = null;
    let actionName = '';

    switch (data) {
        case 'power_on':
            action = 'PowerOn';
            actionName = 'Включение сервера';
            break;
        case 'power_off':
            action = 'ShutDownGuestOS';
            actionName = 'Выключение сервера';
            break;
        case 'reboot':
            action = 'PowerReboot';
            actionName = 'Перезагрузка';
            break;
        case 'status':
            await bot.editMessageText('⏳ Получаю статус...', { chat_id: chatId, message_id: messageId });
            const statusResult = await getServerStatus();
            if (statusResult.success) {
                const s = statusResult.data;
                await bot.editMessageText(
                    `📊 *Статус сервера:*\n\n` +
                    `🏷 Имя: ${s.Name}\n` +
                    `📍 IP: ${s.IP}\n` +
                    `🔋 Питание: ${s.IsPowerOn ? '✅ Вкл' : '❌ Выкл'}\n` +
                    `💻 ОС: ${s.Image}\n` +
                    `⚙️ CPU: ${s.CPU} | RAM: ${s.RAM}MB\n` +
                    `💽 HDD: ${s.HDD}GB`,
                    { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getKeyboard() }
                );
            } else {
                await bot.editMessageText(`❌ Ошибка: ${statusResult.error}`,
                    { chat_id: chatId, message_id: messageId, reply_markup: getKeyboard() });
            }
            return;
        case 'holidays':
            const upcomingH = holidays.getUpcomingHolidays(62);
            const monthNamesH = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
            
            const byMonthH = {};
            for (const h of upcomingH) {
                const parts = h.date.split('.');
                const monthKey = `${parts[2]}-${parts[1]}`;
                const monthNum = parseInt(parts[1]) - 1;
                const year = parseInt(parts[2]);
                
                if (!byMonthH[monthKey]) {
                    byMonthH[monthKey] = { name: `${monthNamesH[monthNum]} ${year}`, holidays: [] };
                }
                byMonthH[monthKey].holidays.push(h);
            }
            
            let hText = '📅 *Праздники РФ*\n';
            for (const [key, month] of Object.entries(byMonthH)) {
                hText += `\n*${month.name}:*\n`;
                for (const h of month.holidays.slice(0, 8)) {
                    let icon = h.isPublicHoliday ? (h.isWeekend ? '🔵' : '🔴') : '⚪';
                    hText += `${icon} ${h.date.substring(0, 5)} - ${h.name}\n`;
                }
                if (month.holidays.length > 8) hText += `... и ещё ${month.holidays.length - 8}\n`;
            }
            hText += '\n🔴 спросит | 🔵 выходной';
            
            await bot.editMessageText(hText, 
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getKeyboard() });
            return;
        case 'schedule':
            const sch = getSchedule();
            const startMin = 60 - sch.serverStartMinutesBefore;
            const startH = sch.startHour - 1;
            await bot.editMessageText(
                '⚙️ *Расписание парсера:*\n\n' +
                `📆 Дни: ${sch.workDaysNames.join(', ')}\n` +
                `⏰ Время: ${String(sch.startHour).padStart(2,'0')}:00 - ${String(sch.endHour).padStart(2,'0')}:00\n` +
                `🚀 Автозапуск: ${String(startH).padStart(2,'0')}:${String(startMin).padStart(2,'0')}\n` +
                `🛑 Автостоп: ${String(sch.endHour).padStart(2,'0')}:05\n\n` +
                '🎄 Праздники РФ учитываются\n\n' +
                '*Команды:*\n' +
                '`/settime 6 18` - время 06:00-18:00\n' +
                '`/setdays 1,2,3,4,5` - дни (1=Пн)',
                { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: getKeyboard() }
            );
            return;
        default:
            return;
    }

    if (action) {
        await bot.editMessageText(`⏳ ${actionName}...`, { chat_id: chatId, message_id: messageId });
        const result = await serverAction(action);
        
        if (result.success) {
            if (action === 'PowerOn') {
                await waitForPowerStatus(true, chatId, messageId, actionName);
            } else if (action === 'ShutDownGuestOS') {
                await waitForPowerStatus(false, chatId, messageId, actionName);
            } else {
                await bot.editMessageText(`✅ ${actionName} - команда выполнена`,
                    { chat_id: chatId, message_id: messageId, reply_markup: getKeyboard() });
            }
        } else {
            await bot.editMessageText(`❌ Ошибка: ${result.error}`,
                { chat_id: chatId, message_id: messageId, reply_markup: getKeyboard() });
        }
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    log(`Ошибка polling: ${error.message}`);
});

// ============================================================================
// ЭКСПОРТ ФУНКЦИЙ ДЛЯ CRON
// ============================================================================

module.exports = {
    checkAndStartParser,
    checkAndStopParser,
    getServerStatus,
    powerOnServer,
    powerOffServer
};

// ============================================================================
// ЗАПУСК
// ============================================================================

// Устанавливаем команды бота
bot.setMyCommands([
    { command: 'start', description: '🎛 Панель управления' },
    { command: 'check', description: '📊 Проверить статус' },
    { command: 'schedule', description: '⚙️ Расписание парсера' },
    { command: 'holidays', description: '📅 Ближайшие праздники' }
]);

// Инициализация cron при запуске
setTimeout(() => {
    const schedule = getSchedule();
    updateCronJobs(schedule);
}, 2000);

log('🤖 Бот запущен!');
log(`📍 Группа: ${ALLOWED_GROUP_ID}`);
log(`🖥 Сервер: ${SERVER_ID}`);

// Если запущен напрямую (не через require) - проверяем аргументы
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--check-start')) {
        // Запуск проверки утреннего старта
        checkAndStartParser().then(result => {
            log(`Результат проверки: ${JSON.stringify(result)}`);
            if (result.action !== 'waiting_confirmation') {
                process.exit(0);
            }
            // Если ждём подтверждения - не выходим сразу
        });
    } else if (args.includes('--check-stop')) {
        // Запуск проверки вечерней остановки
        checkAndStopParser().then(() => process.exit(0));
    }
    // Иначе просто работаем как бот
}
