import { useCallback, useMemo, useState } from 'react';
import type { CartLine, TraySize } from '../types';

export interface CartApi {
  cart: CartLine[];
  add: (itemId: string, size: TraySize, quantity: number) => void;
  setQuantity: (itemId: string, size: TraySize, quantity: number) => void;
  remove: (itemId: string, size: TraySize) => void;
  clear: () => void;
  quantityOf: (itemId: string, size: TraySize) => number;
  count: number;
}

export function useCart(): CartApi {
  const [cart, setCart] = useState<CartLine[]>([]);

  const add = useCallback((itemId: string, size: TraySize, quantity: number) => {
    if (quantity < 1) return;
    setCart((prev) => {
      const existing = prev.find((line) => line.itemId === itemId && line.size === size);
      if (!existing) return [...prev, { itemId, size, quantity }];
      return prev.map((line) =>
        line === existing ? { ...line, quantity: line.quantity + quantity } : line,
      );
    });
  }, []);

  const setQuantity = useCallback((itemId: string, size: TraySize, quantity: number) => {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((line) => !(line.itemId === itemId && line.size === size))
        : prev.map((line) =>
            line.itemId === itemId && line.size === size ? { ...line, quantity } : line,
          ),
    );
  }, []);

  const remove = useCallback((itemId: string, size: TraySize) => {
    setCart((prev) => prev.filter((line) => !(line.itemId === itemId && line.size === size)));
  }, []);

  const clear = useCallback(() => setCart([]), []);

  const quantityOf = useCallback(
    (itemId: string, size: TraySize) =>
      cart.find((line) => line.itemId === itemId && line.size === size)?.quantity ?? 0,
    [cart],
  );

  const count = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  return { cart, add, setQuantity, remove, clear, quantityOf, count };
}
