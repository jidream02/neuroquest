import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from './theme';

// ---------- Экран ----------

export function Screen({
  children, scroll = true, padded = true, edges = ['bottom'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const inner = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, styles.scrollContent]} keyboardShouldPersistTaps="handled">
          <View style={styles.maxWidth}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.flex, inner]}>
          <View style={[styles.flex, styles.maxWidth]}>{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- Текст ----------

export const Title = ({ children, style }: { children: React.ReactNode; style?: object }) => (
  <Text style={[styles.title, style]}>{children}</Text>
);
export const Subtitle = ({ children }: { children: React.ReactNode }) => <Text style={styles.subtitle}>{children}</Text>;
export const Muted = ({ children, style }: { children: React.ReactNode; style?: object }) => (
  <Text style={[styles.muted, style]}>{children}</Text>
);
export const SectionTitle = ({ children }: { children: React.ReactNode }) => <Text style={styles.section}>{children}</Text>;

// ---------- Кнопка ----------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title, onPress, variant = 'primary', loading = false, disabled = false, icon, style, small = false,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        styles[`btn_${variant}`],
        pressed && !off && styles.btnPressed,
        off && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.text} />
      ) : (
        <Text style={[styles.btnText, small && styles.btnTextSmall, variant === 'primary' && styles.btnTextPrimary, variant === 'danger' && styles.btnTextDanger]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

// ---------- Поле ввода ----------

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        {...props}
        style={[styles.input, props.multiline && styles.inputMulti, error ? styles.inputError : null, props.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export const FormError = ({ message }: { message?: string | null }) =>
  message ? (
    <View style={styles.formError}>
      <Text style={styles.formErrorText}>⚠️ {message}</Text>
    </View>
  ) : null;

// ---------- Карточка ----------

export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}>
      {children}
    </Pressable>
  );
}

// ---------- Выбор из вариантов ----------

export function ChipGroup<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Полоска HP / опыта ----------

export function Bar({ value, max, color = colors.danger, label }: { value: number; max: number; color?: string; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View>
      {label ? (
        <View style={styles.barLabelRow}>
          <Text style={styles.barLabel}>{label}</Text>
          <Text style={styles.barLabel}>
            {value}/{max}
          </Text>
        </View>
      ) : null}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export const Badge = ({ text, color = colors.purpleDark }: { text: string; color?: string }) => (
  <View style={[styles.badge, { backgroundColor: color }]}>
    <Text style={styles.badgeText}>{text}</Text>
  </View>
);

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Muted style={styles.center}>{text}</Muted>
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export const Loading = () => (
  <View style={[styles.flex, styles.centerBox]}>
    <ActivityIndicator color={colors.gold} size="large" />
  </View>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.row, style]}>{children}</View>
);

export const Spacer = ({ h = space.md }: { h?: number }) => <View style={{ height: h }} />;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  padded: { padding: space.lg },
  scrollContent: { flexGrow: 1 },
  maxWidth: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  center: { textAlign: 'center' },
  centerBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  title: { color: colors.gold, fontSize: 28, fontFamily: fonts.serif, fontWeight: '700', marginBottom: space.xs },
  subtitle: { color: colors.text, fontSize: 18, fontFamily: fonts.serif, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  section: {
    color: colors.gold, fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: space.xl, marginBottom: space.sm,
  },

  btn: {
    minHeight: 50, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  btnSmall: { minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.sm },
  btn_primary: { backgroundColor: colors.gold },
  btn_secondary: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  btn_danger: { backgroundColor: 'transparent', borderColor: colors.danger },
  btn_ghost: { backgroundColor: 'transparent' },
  btnPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14 },
  btnTextPrimary: { color: colors.bg },
  btnTextDanger: { color: colors.danger },

  field: { marginBottom: space.md },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13, marginTop: 4 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  formError: { backgroundColor: '#3A1820', borderRadius: radius.md, padding: space.md, marginBottom: space.md, borderWidth: 1, borderColor: colors.danger },
  formErrorText: { color: colors.text, fontSize: 14 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border,
    marginBottom: space.md,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.purpleDark, borderColor: colors.purple },
  chipText: { color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.text },

  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: { fontSize: 56, marginBottom: space.md },
  emptyTitle: { color: colors.text, fontSize: 20, fontFamily: fonts.serif, fontWeight: '700', marginBottom: space.sm },
});
