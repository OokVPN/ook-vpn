import { getProject } from "../lib/config.js";

// Texts that mention the project are built from config.json (project.*),
// so nothing about the brand is hardcoded in the handlers.

export function welcomeText() {
  const { name } = getProject();

  return (
    `👋 Добро пожаловать в ${name}!\n\n` +
    "Выбери нужный раздел:"
  );
}

export function maintenanceText() {
  const { name, channel } = getProject();

  return (
    `🛠 ${name} временно закрыт\n\n` +
    "Мы делаем масштабную переработку VPN.\n\n" +
    "Текущая подписка продолжает работать до выхода новой версии.\n\n" +
    `Следите за новостями в канале: ${channel}.`
  );
}

export function helpText() {
  const { support } = getProject();

  return (
    "❓ Помощь\n\n" +
    "Если у тебя возникли проблемы с VPN, " +
    `обратись в поддержку: ${support}.`
  );
}

export function defaultPlanDescription() {
  return `Подписка ${getProject().name}`;
}
