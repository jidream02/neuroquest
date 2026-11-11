import React, { useCallback, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { createCampaign, listCharacters } from '../../db/repo';
import { campaignSchema, fieldErrors } from '../../lib/validation';
import { useSession } from '../../services/AuthContext';
import { Button, ChipGroup, Field, FormError, Loading, Muted, Screen, SectionTitle, Spacer } from '../../ui/components';
import { HeroCard } from '../../ui/HeroCard';
import { errorMessage } from '../../ui/dialogs';
import { useLoad } from '../../ui/useLoad';
import { parseId } from '../../ui/params';

const SETTINGS = [
  { value: 'classic', label: '🏰 Классика', text: 'Классическое фэнтези: королевства, драконы, древние руины.' },
  { value: 'dark', label: '🕯️ Мрачное', text: 'Мрачное фэнтези: чума, проклятия, нежить и тяжёлый выбор.' },
  { value: 'pirates', label: '🏴‍☠️ Пираты', text: 'Архипелаг пиратов, морские чудовища и затонувшие сокровища.' },
  { value: 'north', label: '❄️ Север', text: 'Суровые северные земли, викинги, ледяные великаны и руны.' },
  { value: 'desert', label: '🏜️ Пустыня', text: 'Пустынные султанаты, джинны, караваны и забытые гробницы.' },
  { value: 'custom', label: '✍️ Свой мир', text: '' },
] as const;
type SettingId = (typeof SETTINGS)[number]['value'];

export default function NewCampaignScreen() {
  const db = useSQLiteContext();
  const { userId } = useSession();
  const { data: heroes, loading } = useLoad(useCallback(() => listCharacters(db, userId), [db, userId]));
  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState<SettingId>('classic');
  const [custom, setCustom] = useState('');
  // Герой из ссылки «В приключение» (с листа персонажа)
  const fromSheet = parseId(useLocalSearchParams<{ heroId?: string }>().heroId);
  const [heroId, setHeroId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  // Параметр из ссылки принимается, только если это герой текущего пользователя.
  const preset0 = heroes?.some((h) => h.id === fromSheet) ? fromSheet : null;
  const selectedHero = heroId ?? preset0 ?? heroes?.[0]?.id ?? null;
  const setting = preset === 'custom' ? custom : SETTINGS.find((s) => s.value === preset)!.text;

  const submit = async () => {
    setFormError(null);
    const parsed = campaignSchema.safeParse({ title, setting, characterId: selectedHero ?? 0 });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    const hero = heroes?.find((h) => h.id === parsed.data.characterId);
    if (hero && hero.hp === 0) {
      setFormError('Герой без сознания (0 HP). Откройте его лист и отдохните.');
      return;
    }
    setBusy(true);
    try {
      const id = await createCampaign(db, userId, parsed.data);
      router.replace(`/play/${id}`);
    } catch (e) {
      setFormError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FormError message={formError} />
      <Field label="Название приключения" value={title} onChangeText={setTitle} maxLength={60} error={errors.title} placeholder="Тень над Грифоном" />

      <SectionTitle>Мир</SectionTitle>
      <ChipGroup options={SETTINGS.map((s) => ({ value: s.value, label: s.label }))} value={preset} onChange={setPreset} />
      <Spacer h={8} />
      {preset === 'custom' ? (
        <Field
          label="Опишите свой мир"
          value={custom}
          onChangeText={setCustom}
          multiline
          maxLength={400}
          error={errors.setting}
          hint={`${custom.length}/400`}
          placeholder="Город на спине гигантской черепахи…"
        />
      ) : (
        <Muted>{setting}</Muted>
      )}

      <SectionTitle>Герой</SectionTitle>
      {errors.characterId ? <Muted style={{ color: '#E05561' }}>{errors.characterId}</Muted> : null}
      {heroes?.map((h) => (
        <HeroCard key={h.id} hero={h} selected={h.id === selectedHero} onPress={() => setHeroId(h.id)} />
      ))}
      <Spacer />
      <Button title="Начать приключение" icon="⚔️" onPress={submit} loading={busy} />
    </Screen>
  );
}
