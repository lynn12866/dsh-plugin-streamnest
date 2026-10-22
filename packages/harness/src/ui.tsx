import { Children, forwardRef, isValidElement, useState, type ComponentProps } from 'react';
import type { OptionHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import {
  Button as HarnessButton,
  Input as HarnessInput,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives';

import fieldStyles from 'harness:input-style';

export {
  Button,
  Checkbox,
  Menu,
  Modal,
  SegmentedControl,
  SegmentedTabs,
  StateDot,
  Tag,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives';

export const Input = forwardRef<HTMLInputElement, ComponentProps<typeof HarnessInput>>(
  function Input({ className = '', ...props }, ref) {
    return <HarnessInput {...props} ref={ref} className={`mv-compact-input ${className}`} />;
  },
);

// Compose the public Harness button and menu; hidden inputs retain native FormData support.
export function Select({
  id,
  name,
  value,
  defaultValue,
  onChange,
  children,
  className = '',
  disabled,
  'aria-label': ariaLabel,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
}) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];

    return [
      { value: String(child.props.value ?? child.props.children), label: child.props.children },
    ];
  });
  const [localValue, setLocalValue] = useState(defaultValue ?? options[0]?.value ?? '');
  const [open, setOpen] = useState(false);
  const selection = value ?? localValue;
  const label = options.find((option) => option.value === selection)?.label;
  const labelText = typeof label === 'string' ? label : undefined;

  return (
    <>
      <Menu
        className={`mv-select ${className}`}
        open={open}
        portal
        compact
        dense
        selectedId={`option:${selection}`}
        onClose={() => setOpen(false)}
        onSelect={(item) => {
          const next = item.slice('option:'.length);
          setLocalValue(next);
          onChange?.(next);
          setOpen(false);
        }}
        items={options.map((option) => ({ id: `option:${option.value}`, label: option.label }))}
        anchor={
          <Tooltip label={labelText ?? ''} disabled={open || !labelText} portal side="top">
            <HarnessButton
              id={id}
              size="sm"
              variant="outline"
              disabled={disabled}
              aria-label={ariaLabel}
              aria-description={labelText}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span className="mv-select-value">{label}</span>
              <LuChevronDown size={16} aria-hidden />
            </HarnessButton>
          </Tooltip>
        }
      />
      {name && <input type="hidden" name={name} value={selection} />}
    </>
  );
}

export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <span className={`${fieldStyles.wrap} mv-textarea ${className}`}>
      <textarea {...props} className={fieldStyles.input} />
    </span>
  );
}
