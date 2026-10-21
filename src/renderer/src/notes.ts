import type { PetNote } from '../../shared/protocol';

/** Shared look of a note, whether shown as the octopus's bubble or as a card in the chat. */
export const NOTE_ICON: Record<PetNote['kind'], string> = { sidekick: '', done: '✓ ', waiting: '! ', long: '≡ ', conflict: '⚠ ' };

export const NOTE_HINT: Record<PetNote['kind'], string> = {
  sidekick: 'Open the chat',
  done: 'Open this project in VS Code',
  waiting: 'Open this project in VS Code',
  long: 'Get a summary and a fresh-chat prompt',
  conflict: 'Open this project in VS Code',
};
