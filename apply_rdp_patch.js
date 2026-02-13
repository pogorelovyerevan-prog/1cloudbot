const fs = require('fs');

const oldFunction = `async function startServerIfNeeded() {
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
            `+"`"+`📅 ${getMoscowDate().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n`+"`"+` +
            `+"`"+`⏰ Время работы: ${String(schInfo.startHour).padStart(2,'0')}:00 - ${String(schInfo.endHour).padStart(2,'0')}:00\n\n`+"`"+` +
            'Сервер включается, Chrome запустится автоматически.',
            { parse_mode: 'Markdown' }
        );
        
        return { action: 'started', reason: 'server_powered_on' };
    } else {
        log(`+"`"+`❌ Ошибка запуска: ${result.error}`+"`"+`);
        return { action: 'error', reason: result.error };
    }
}`;

const newFunction = `async function startServerIfNeeded() {
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
            `+"`"+`📅 ${getMoscowDate().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n`+"`"+` +
            `+"`"+`⏰ Время работы: ${String(schInfo.startHour).padStart(2,'0')}:00 - ${String(schInfo.endHour).padStart(2,'0')}:00\n\n`+"`"+` +
            '⏳ Ожидание загрузки Windows и запуска RDP...',
            { parse_mode: 'Markdown' }
        );
        
        // Ждём 60 секунд загрузки Windows
        log('⏳ Ожидание загрузки Windows (60 сек)...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        
        // Запускаем RDP подключение для создания сессии CloudAdmin
        log('🔌 Запуск RDP подключения...');
        exec('/root/1cloudbot/rdp_connect.sh', (error, stdout, stderr) => {
            if (error) {
                log(`+"`"+`⚠️ Ошибка RDP: ${error.message}`+"`"+`);
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
        log(`+"`"+`❌ Ошибка запуска: ${result.error}`+"`"+`);
        return { action: 'error', reason: result.error };
    }
}`;

let code = fs.readFileSync('/root/1cloudbot/bot.js', 'utf8');
code = code.replace(oldFunction, newFunction);
fs.writeFileSync('/root/1cloudbot/bot.js', code);
console.log('✅ Патч применён успешно');
