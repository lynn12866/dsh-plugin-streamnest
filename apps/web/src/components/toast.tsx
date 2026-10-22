import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { LuCircleAlert } from 'react-icons/lu';

import { Toast } from '../../../../packages/harness/src/ui';
import { useLanguage } from '../i18n';
import { displayMessage, type DisplayMessage } from '../messages';

interface ToastOptions {
  tone?: 'success' | 'error' | 'info';
  holdMs?: number;
  actions?: readonly { label: DisplayMessage; onClick: () => void }[];
}

type ShowToast = (message: DisplayMessage, options?: ToastOptions) => void;
const ToastContext = createContext<ShowToast | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const sequence = useRef(0);
  const [current, setCurrent] = useState<
    (ToastOptions & { id: number; message: DisplayMessage }) | undefined
  >();
  const show = useCallback<ShowToast>((message, options = {}) => {
    setCurrent({ ...options, id: ++sequence.current, message });
  }, []);
  const dismiss = (id: number) => {
    setCurrent((value) => (value?.id === id ? undefined : value));
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      {current && (
        <Toast
          key={current.id}
          text={displayMessage(current.message)}
          tone={current.tone === 'success' ? 'success' : undefined}
          icon={current.tone === 'error' ? <LuCircleAlert size={18} /> : undefined}
          holdMs={
            current.holdMs ?? (current.tone === 'error' || current.actions?.length ? 6_000 : 3_000)
          }
          actions={current.actions?.map((action) => ({
            label: displayMessage(action.label),
            onClick: () => {
              action.onClick();
              dismiss(current.id);
            },
          }))}
          onDone={() => dismiss(current.id)}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast requires ToastProvider.');

  return show;
}
