/**
 * TITAN TRADING BOT - NOTIFICATION SERVICE
 * ---------------------------------------------------------
 * @module utils/notifications.ts
 * @version 1.0.0
 * @phase Phase 42: The Oracle Protocol
 * @last-updated 2025-06-08
 * @description
 * Управляет разрешениями и отправкой системных уведомлений браузера.
 * ---------------------------------------------------------
 */

let hasPermission: boolean | null = null;

/**
 * Запрашивает у пользователя разрешение на отправку уведомлений.
 * Вызывается при первом действии пользователя (например, запуск бота).
 */
export const requestNotificationPermission = async (): Promise<void> => {
    if (!('Notification' in window)) {
        console.warn('This browser does not support desktop notification');
        hasPermission = false;
        return;
    }

    if (Notification.permission === 'granted') {
        hasPermission = true;
        return;
    }

    if (Notification.permission !== 'denied') {
        try {
            const permission = await Notification.requestPermission();
            hasPermission = permission === 'granted';
        } catch (error) {
            console.error('Error requesting notification permission:', error);
            hasPermission = false;
        }
    } else {
        hasPermission = false;
    }
};

/**
 * Отправляет системное уведомление, если разрешение было предоставлено.
 * @param title - Заголовок уведомления.
 * @param options - Тело и другие опции уведомления.
 */
export const sendNotification = (title: string, options?: NotificationOptions): void => {
    if (hasPermission === null) {
        // Permission state is not yet determined, queue or drop? For now, we drop.
        return;
    }

    if (hasPermission) {
        new Notification(title, {
            ...options,
            icon: '/vite.svg', // Optional: add an icon
            badge: '/vite.svg', // For mobile
        });
    }
};