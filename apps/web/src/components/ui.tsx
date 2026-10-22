import { t } from '../i18n';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { Button as NativeButton, Modal, StateDot } from '../../../../packages/harness/src/ui';

export {
  Input,
  Checkbox,
  Select,
  SegmentedControl,
  Tag,
  StateDot,
} from '../../../../packages/harness/src/ui';

export function Button({
  icon: Icon,
  loading,
  children,
  variant = 'outline',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconType;
  loading?: boolean;
  variant?: 'primary' | 'outline' | 'ghost';
}) {
  return (
    <NativeButton
      {...props}
      size="sm"
      variant={variant}
      disabled={disabled || loading}
      icon={loading ? <StateDot state="ongoing" /> : Icon && <Icon size={16} aria-hidden />}
    >
      {children}
    </NativeButton>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="mv-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="mv-muted mv-small">{hint}</span>}
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      closeLabel={t('common.close')}
      className="mv-dialog"
      contentClassName="mv-dialog-content"
    >
      {children}
    </Modal>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: IconType;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mv-empty">
      <Icon size={28} aria-hidden />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mv-page-top">
      <div>
        <h1>{title}</h1>
        {description && <p className="mv-muted">{description}</p>}
      </div>
      <div className="mv-actions">{children}</div>
    </header>
  );
}

export const bytes = (value: number, zero = '—') => {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (!value) return zero;
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]}`;
};
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
