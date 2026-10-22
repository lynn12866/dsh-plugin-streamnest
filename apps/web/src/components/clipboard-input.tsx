import { message, type DisplayMessage } from '../messages';
import { useRef, useState, type ComponentProps } from 'react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';

import { Input } from './ui';
import { t } from '../i18n';

export function ClipboardInput({
  value,
  onChange,
  onError,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onError' | 'ref'> & {
  value: string;
  onChange: (value: string) => void;
  onError: (message: DisplayMessage) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; start: number; end: number }>();
  function close() {
    setMenu(undefined);
    input.current?.focus();
  }
  async function act(action: string) {
    if (!menu || !input.current) return;
    const { start, end } = menu;
    let caret = start;
    try {
      if (action === 'select-all') {
        close();
        input.current.select();
        return;
      }
      if (action === 'copy' || action === 'cut')
        await navigator.clipboard.writeText(value.slice(start, end));
      if (action === 'paste') {
        const text = await navigator.clipboard.readText();
        onChange(value.slice(0, start) + text + value.slice(end));
        caret += text.length;
      } else if (action === 'cut' || action === 'delete')
        onChange(value.slice(0, start) + value.slice(end));
      else caret = end;
      close();
      requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
    } catch {
      onError(message('clipboard.actionFailed'));
      close();
    }
  }
  return (
    <Menu
      open={!!menu}
      portal
      compact
      dense
      autoFocus
      className="mv-clipboard-input"
      getAnchorRect={() => (menu ? new DOMRect(menu.x, menu.y, 0, 0) : null)}
      onClose={close}
      onSelect={(action) => void act(action)}
      items={[
        { id: 'cut', label: t('common.cut'), disabled: menu?.start === menu?.end },
        { id: 'copy', label: t('common.copy'), disabled: menu?.start === menu?.end },
        { id: 'paste', label: t('common.paste') },
        { id: 'delete', label: t('common.deleteSelection'), disabled: menu?.start === menu?.end },
        { id: 'select-all', label: t('common.selectAll'), disabled: !value },
      ]}
      anchor={
        <Input
          {...props}
          ref={input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onContextMenu={(event) => {
            if (props.disabled) return;
            event.preventDefault();
            setMenu({
              x: event.clientX,
              y: event.clientY,
              start: event.currentTarget.selectionStart ?? 0,
              end: event.currentTarget.selectionEnd ?? 0,
            });
          }}
        />
      }
    />
  );
}
