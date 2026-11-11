import React, { useCallback } from 'react';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { listCharacters } from '../../db/repo';
import { useSession } from '../../services/AuthContext';
import { Button, EmptyState, FormError, Loading, Muted, Screen, Spacer } from '../../ui/components';
import { HeroCard } from '../../ui/HeroCard';
import { useLoad } from '../../ui/useLoad';

export default function HeroesScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const { data: heroes, error, loading } = useLoad(useCallback(() => listCharacters(db, userId), [db, userId]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <FormError message={error} />
      {heroes && heroes.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="Пока нет героев"
          text="Создайте персонажа: выберите расу, класс и распределите характеристики."
          action={<Button title="Создать героя" icon="✨" onPress={() => router.push('/hero/new')} />}
        />
      ) : (
        <>
          <Button title="Новый герой" icon="✨" onPress={() => router.push('/hero/new')} />
          <Spacer />
          <Muted>Героев: {heroes?.length ?? 0}. Нажмите на карточку, чтобы открыть лист персонажа.</Muted>
          <Spacer />
          {heroes?.map((h) => <HeroCard key={h.id} hero={h} onPress={() => router.push(`/hero/${h.id}`)} />)}
        </>
      )}
    </Screen>
  );
}
