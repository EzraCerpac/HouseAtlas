/** A segmented radio group: arrows, Home and End move the choice and the focus. */
export function Choice<T extends string>({ label, value, onChange, options }: {
  readonly label: string; readonly value: T; readonly onChange: (value: T) => void; readonly options: readonly (readonly [T, string])[];
}) {
  const values = options.map(([option]) => option);
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" role="radio" aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onKeyDown={(event) => {
            const current = values.indexOf(option);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1
              : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % values.length
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current + values.length - 1) % values.length : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(values[next]!);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
          }}
          onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}
