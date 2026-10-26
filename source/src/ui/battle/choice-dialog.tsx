import { useEffect, type ReactElement, type ReactNode } from 'react';

/**
 * 待处理选择的统一呈现。
 *
 * 弹窗只负责把领域给出的候选画出来：候选名单来自 controller.weaponTargets()，
 * 点选后发出 SelectWeaponTarget 命令，界面不判断谁合法。
 */

export interface DialogProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly narrow?: boolean;
  readonly onClose: () => void;
}

export function Dialog({
  title,
  subtitle,
  children,
  footer,
  narrow = false,
  onClose,
}: DialogProps): ReactElement {
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={narrow ? 'dialog dialog--narrow' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">{title}</h2>
            {subtitle !== undefined && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
