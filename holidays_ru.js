/**
 * Праздничные дни России через библиотеку date-holidays
 * Автоматически обновляется, включает все официальные праздники РФ
 */

const Holidays = require('date-holidays');

// Инициализируем праздники России
const hd = new Holidays('RU');

/**
 * Проверить, является ли дата праздничным днём
 * @param {Date} date - дата для проверки
 * @returns {Object|null} - информация о празднике или null
 */
function getHoliday(date) {
    const holidays = hd.isHoliday(date);
    
    if (holidays && holidays.length > 0) {
        // Возвращаем первый праздник (основной)
        const holiday = holidays[0];
        return {
            name: holiday.name,
            type: holiday.type, // 'public', 'bank', 'optional', etc.
            date: date
        };
    }
    
    return null;
}

/**
 * Проверить, является ли дата выходным днём (Сб или Вс)
 * @param {Date} date - дата для проверки
 * @returns {boolean}
 */
function isWeekend(date) {
    const dayOfWeek = date.getDay(); // 0 = Вс, 6 = Сб
    return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Проверить, является ли дата рабочим днём (Пн-Пт)
 * @param {Date} date - дата для проверки
 * @returns {boolean}
 */
function isWorkingDay(date) {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Получить информацию о дне
 * @param {Date} date - дата для проверки
 * @returns {Object} - полная информация о дне
 */
function getDayInfo(date) {
    const holiday = getHoliday(date);
    const weekend = isWeekend(date);
    const workingDay = isWorkingDay(date);
    
    // Проверяем тип праздника - только public holidays считаются нерабочими
    const isPublicHoliday = holiday && holiday.type === 'public';
    
    return {
        date: date,
        dateString: date.toLocaleDateString('ru-RU', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        }),
        isHoliday: holiday !== null,
        isPublicHoliday: isPublicHoliday,
        holidayName: holiday ? holiday.name : null,
        holidayType: holiday ? holiday.type : null,
        isWeekend: weekend,
        isWorkingDay: workingDay,
        // Нужно спрашивать пользователя если:
        // - Это официальный праздник И это не выходной (пн-пт праздник)
        needsConfirmation: isPublicHoliday && !weekend && workingDay
    };
}

/**
 * Получить список праздников на ближайшие дни
 * @param {number} days - количество дней вперёд
 * @returns {Array} - список праздников
 */
function getUpcomingHolidays(days = 30) {
    const holidays = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        
        const holiday = getHoliday(checkDate);
        if (holiday) {
            holidays.push({
                date: checkDate.toLocaleDateString('ru-RU'),
                name: holiday.name,
                type: holiday.type,
                isWeekend: isWeekend(checkDate),
                isPublicHoliday: holiday.type === 'public'
            });
        }
    }
    
    return holidays;
}

/**
 * Получить праздники за год
 * @param {number} year - год
 * @returns {Array} - все праздники года
 */
function getYearHolidays(year = new Date().getFullYear()) {
    return hd.getHolidays(year);
}

module.exports = {
    getHoliday,
    isWeekend,
    isWorkingDay,
    getDayInfo,
    getUpcomingHolidays,
    getYearHolidays,
    // Экспортируем инстанс для прямого доступа если нужно
    holidaysInstance: hd
};
