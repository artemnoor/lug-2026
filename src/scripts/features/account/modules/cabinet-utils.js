export const messengerLabels = { telegram: 'Telegram', vk: 'VK', max: 'MAX' };

export function nameInitial(name = '') {
  return name.trim().charAt(0).toUpperCase() || 'У';
}

export function plural(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  return mod10 === 1 && mod100 !== 11
    ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
      ? few
      : many;
}
