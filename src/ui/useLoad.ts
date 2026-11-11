import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from './dialogs';

/**
 * Загружает данные при каждом показе экрана (например, после возврата с экрана редактирования).
 * loader нужно обернуть в useCallback, чтобы загрузка не повторялась на каждый рендер.
 */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    () =>
      loader().then(
        (d) => {
          setData(d);
          setError(null);
          setLoading(false);
        },
        (e) => {
          setError(errorMessage(e));
          setLoading(false);
        },
      ),
    [loader],
  );

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, loading, reload };
}
