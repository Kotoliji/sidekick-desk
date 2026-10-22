import type { PetNote } from '../../shared/protocol';

/** Shared look of a note, whether shown as the octopus's bubble or as a card in the chat. */
export const NOTE_ICON: Record<PetNote['kind'], string> = { sidekick: '', done: '✓ ', waiting: '! ', long: '≡ ', conflict: '⚠ ', ask: '? ' };

export const ASK_LABEL = { keep: 'Still using', done: 'Done' } as const;

export const NOTE_HINT: Record<PetNote['kind'], string> = {
  sidekick: 'Open the chat',
  done: 'Open this project in VS Code',
  waiting: 'Open this project in VS Code',
  long: 'Get a summary and a fresh-chat prompt',
  conflict: 'Open this project in VS Code',
  ask: 'Open this project in VS Code',
};

/** "Still using / Done" for an idle-chat question, in a bubble or on its card. */
export function AskButtons({ id, onAnswer }: { id: number; onAnswer?: () => void }) {
  return (
    <span className="ask-actions">
      {(['keep', 'done'] as const).map((choice) => (
        <button
          key={choice}
          className={`ask-btn ask-${choice}`}
          onClick={(e) => {
            e.stopPropagation(); // not a click on the card itself
            window.sidekick.answerNote(id, choice);
            onAnswer?.();
          }}
        >
          {ASK_LABEL[choice]}
        </button>
      ))}
    </span>
  );
}
