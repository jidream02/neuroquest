import React, { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { baseAbilities, getCharacter, updateCharacter } from '../../../db/repo';
import { useSession } from '../../../services/AuthContext';
import { EmptyState, Loading, Screen } from '../../../ui/components';
import { HeroForm } from '../../../ui/HeroForm';
import { useLoad } from '../../../ui/useLoad';
import { parseId } from '../../../ui/params';

export default function EditHeroScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const id = parseId(useLocalSearchParams<{ id: string }>().id);
  const { data: hero, loading } = useLoad(useCallback(() => (id ? getCharacter(db, userId, id) : Promise.resolve(null)), [db, userId, id]));

  if (loading) return <Loading />;
  if (!hero || !id) return <EmptyState icon="❓" title="Герой не найден" text="Возможно, он удалён или принадлежит другому игроку." />;

  return (
    <Screen>
      <HeroForm
        submitTitle="Сохранить изменения"
        initial={{
          name: hero.name,
          raceId: hero.race_id,
          classId: hero.class_id,
          backstory: hero.backstory,
          abilities: baseAbilities(hero),
        }}
        onSubmit={async (form) => {
          await updateCharacter(db, userId, id, form);
          router.back();
        }}
      />
    </Screen>
  );
}
