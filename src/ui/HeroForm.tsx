import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ABILITIES, type Ability } from '../../shared/dmProtocol';
import {
  ABILITY_LABELS, ABILITY_MAX, ABILITY_MIN, CLASSES, MAX_ABILITY_TOTAL, RACES, classById, effectiveAbilities,
  formatMod, maxHpFor, modifier, raceById, roll4d6DropLowest, type Abilities,
} from '../lib/rules';
import { fieldErrors, heroSchema, type HeroForm as HeroFormData } from '../lib/validation';
import { Button, Card, ChipGroup, Field, FormError, Muted, Row, SectionTitle } from './components';
import { colors, fonts, radius, space } from './theme';

const STANDARD: Abilities = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

export function HeroForm({
  initial, submitTitle, onSubmit,
}: {
  initial?: HeroFormData;
  submitTitle: string;
  onSubmit: (data: HeroFormData) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [raceId, setRaceId] = useState(initial?.raceId ?? 'human');
  const [classId, setClassId] = useState(initial?.classId ?? 'fighter');
  const [backstory, setBackstory] = useState(initial?.backstory ?? '');
  const [abilities, setAbilities] = useState<Abilities>(initial?.abilities ?? STANDARD);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = Object.values(abilities).reduce((a, b) => a + b, 0);
  const eff = effectiveAbilities(abilities, raceId);
  const race = raceById(raceId);
  const cls = classById(classId);

  const step = (k: Ability, d: number) =>
    setAbilities((a) => ({ ...a, [k]: Math.max(ABILITY_MIN, Math.min(ABILITY_MAX, a[k] + d)) }));

  const rollAll = () => {
    // Перебрасываем, пока сумма не уложится в лимит (честный, но не «читерский» набор).
    let next: Abilities;
    do {
      next = { str: roll4d6DropLowest(), dex: roll4d6DropLowest(), con: roll4d6DropLowest(), int: roll4d6DropLowest(), wis: roll4d6DropLowest(), cha: roll4d6DropLowest() };
    } while (Object.values(next).reduce((a, b) => a + b, 0) > MAX_ABILITY_TOTAL);
    setAbilities(next);
  };

  const submit = async () => {
    setFormError(null);
    const parsed = heroSchema.safeParse({ name, raceId, classId, backstory, abilities });
    if (!parsed.success) {
      const fe = fieldErrors(parsed.error);
      setErrors(fe);
      setFormError(fe.abilities ?? 'Проверьте поля формы');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  };

  return (
    <View>
      <FormError message={formError} />
      <Field label="Имя героя" value={name} onChangeText={setName} maxLength={40} error={errors.name} placeholder="Арен Сребролист" />

      <SectionTitle>Раса</SectionTitle>
      <ChipGroup options={RACES.map((r) => ({ value: r.id, label: `${r.emoji} ${r.name}` }))} value={raceId} onChange={setRaceId} />
      <Muted style={{ marginTop: space.sm }}>
        Бонус: {Object.entries(race.bonus).map(([k, v]) => `${ABILITY_LABELS[k as Ability].short} +${v}`).join(', ')}
      </Muted>

      <SectionTitle>Класс</SectionTitle>
      <ChipGroup options={CLASSES.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))} value={classId} onChange={setClassId} />
      <Muted style={{ marginTop: space.sm }}>
        Кость хитов d{cls.hitDie} · основная характеристика {ABILITY_LABELS[cls.primary].full} · HP на 1 ур.:{' '}
        {maxHpFor(classId, 1, eff.con)}
      </Muted>

      <SectionTitle>Характеристики</SectionTitle>
      <Row style={{ marginBottom: space.sm }}>
        <Button small variant="secondary" title="Бросить 4d6" icon="🎲" onPress={rollAll} style={{ flex: 1 }} />
        <Button small variant="secondary" title="Стандартный набор" onPress={() => setAbilities(STANDARD)} style={{ flex: 1 }} />
      </Row>
      <Card>
        {ABILITIES.map((k) => (
          <View key={k} style={styles.abilityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.abilityName}>{ABILITY_LABELS[k].full}</Text>
              <Text style={styles.abilityEff}>
                итог {eff[k]} ({formatMod(modifier(eff[k]))}){cls.primary === k ? ' · основная' : ''}
              </Text>
            </View>
            <Pressable accessibilityLabel={`Уменьшить ${ABILITY_LABELS[k].full}`} style={styles.stepBtn} onPress={() => step(k, -1)}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.abilityValue}>{abilities[k]}</Text>
            <Pressable accessibilityLabel={`Увеличить ${ABILITY_LABELS[k].full}`} style={styles.stepBtn} onPress={() => step(k, 1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ))}
        <Text style={[styles.total, total > MAX_ABILITY_TOTAL && { color: colors.danger }]}>
          Сумма: {total} / {MAX_ABILITY_TOTAL}
        </Text>
      </Card>

      <Field
        label="Предыстория (необязательно)"
        value={backstory}
        onChangeText={setBackstory}
        multiline
        maxLength={600}
        error={errors.backstory}
        hint={`${backstory.length}/600 — мастер учтёт её в сюжете`}
        placeholder="Бывший стражник, ищет того, кто сжёг его деревню…"
      />
      <Button title={submitTitle} icon="💾" onPress={submit} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  abilityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm },
  abilityName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  abilityEff: { color: colors.textMuted, fontSize: 12 },
  abilityValue: { color: colors.gold, fontSize: 20, fontWeight: '800', width: 36, textAlign: 'center', fontFamily: fonts.serif },
  stepBtn: {
    width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  stepText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  total: { color: colors.textMuted, textAlign: 'right', marginTop: space.sm, fontWeight: '700' },
});
