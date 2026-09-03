/* eslint-disable */
type Localize = (messageParts: TemplateStringsArray, ...expressions: readonly unknown[]) => string;

const stripLocalizeBlock = (value: string): string => {
  if (!value.startsWith(':')) {
    return value;
  }

  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === ':' && value[index - 1] !== '\\') {
      return value.slice(index + 1).replaceAll('\\:', ':');
    }
  }

  return value.replaceAll('\\:', ':');
};

const localize: Localize = (messageParts, ...expressions) => {
  let message = stripLocalizeBlock(messageParts[0] ?? '');
  for (let index = 0; index < expressions.length; index += 1) {
    message += String(expressions[index]);
    message += stripLocalizeBlock(messageParts[index + 1] ?? '');
  }
  return message;
};

(globalThis as unknown as { $localize: Localize }).$localize = localize;
