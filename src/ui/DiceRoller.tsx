import React, { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CheckResult } from '../lib/rules';
import { ABILITY_LABELS, formatMod } from '../lib/rules';
import { colors, fonts, radius, space } from './theme';

/**
 * Модальное окно броска d20: кубик крутится, мелькают числа, затем показывается итог.
 * Результат уже посчитан кодом заранее (abilityCheck) — анимация только визуальная.
 * Для каждого броска компонент монтируется заново (key), поэтому состояние всегда свежее.
 */
export function DiceRoller({ result, onDone }: { result: CheckResult; onDone: () => void }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.6));
  const [rotate] = useState(() => spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1080deg'] }));
  const [face, setFace] = useState(20);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const ticker = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), 60);
    Animated.parallel([
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start(() => {
      clearInterval(ticker);
      setFace(result.natural);
      setSettled(true);
    });
    return () => clearInterval(ticker);
  }, [result, spin, scale]);

  const crit = result.natural === 20 ? 'КРИТИЧЕСКИЙ УСПЕХ!' : result.natural === 1 ? 'КРИТИЧЕСКИЙ ПРОВАЛ!' : null;
  const color = result.success ? colors.success : colors.danger;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={settled ? onDone : undefined}>
      <View style={styles.overlay}>
        <Text style={styles.caption}>
          Проверка: {ABILITY_LABELS[result.ability].full} · СЛ {result.dc}
        </Text>
        <Animated.View style={[styles.die, { transform: [{ rotate }, { scale }] }, settled && { borderColor: color }]}>
          <Text style={[styles.face, settled && { color }]}>{face}</Text>
        </Animated.View>
        {settled ? (
          <>
            <Text style={styles.math}>
              d20 {result.natural} {formatMod(result.modifier)} = {result.total}
            </Text>
            {crit ? <Text style={[styles.crit, { color }]}>{crit}</Text> : null}
            <Text style={[styles.verdict, { color }]}>{result.success ? 'Успех' : 'Провал'}</Text>
            <Pressable style={styles.btn} onPress={onDone} accessibilityRole="button">
              <Text style={styles.btnText}>Рассказать мастеру ➤</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.math}>Кубик катится…</Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  caption: { color: colors.textMuted, fontSize: 16, marginBottom: space.xl, fontWeight: '600' },
  die: {
    width: 140, height: 140, borderRadius: 28, backgroundColor: colors.purpleDark, borderWidth: 4, borderColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  face: { color: colors.gold, fontSize: 64, fontWeight: '900', fontFamily: fonts.serif },
  math: { color: colors.text, fontSize: 18, marginTop: space.xl, fontFamily: fonts.mono },
  crit: { fontSize: 18, fontWeight: '900', marginTop: space.sm, letterSpacing: 1 },
  verdict: { fontSize: 32, fontWeight: '800', fontFamily: fonts.serif, marginTop: space.sm },
  btn: { marginTop: space.xl, backgroundColor: colors.gold, paddingVertical: 14, paddingHorizontal: space.xl, borderRadius: radius.md },
  btnText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
});
