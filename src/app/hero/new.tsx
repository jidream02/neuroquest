import React from 'react';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { createCharacter } from '../../db/repo';
import { classById } from '../../lib/rules';
import { useSession } from '../../services/AuthContext';
import { Screen } from '../../ui/components';
import { HeroForm } from '../../ui/HeroForm';

export default function NewHeroScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  return (
    <Screen>
      <HeroForm
        submitTitle="Создать героя"
        onSubmit={async (form) => {
          const id = await createCharacter(db, userId, form, classById(form.classId).startItems);
          router.replace(`/hero/${id}`);
        }}
      />
    </Screen>
  );
}
