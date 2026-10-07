export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  detail?: { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }[];
  tone: 'info' | 'success' | 'error';
  action?: ToastAction;
  timeout: number;
}

let next = 1;

class Toasts {
  items = $state<Toast[]>([]);

  show(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
    const t: Toast = { id: next++, message, tone: 'info', timeout: 4500, ...opts };
    this.items = [...this.items.slice(-2), t];
    if (t.timeout > 0) setTimeout(() => this.dismiss(t.id), t.timeout);
    return t.id;
  }

  error(message: string): number {
    return this.show(message, { tone: 'error', timeout: 7000 });
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
