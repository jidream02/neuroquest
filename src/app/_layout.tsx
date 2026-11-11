import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DB_NAME, migrate } from '../db/schema';
import { AuthProvider, useAuth } from '../services/AuthContext';
import { Loading } from '../ui/components';
import { colors, fonts } from '../ui/theme';

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.gold,
  headerTitleStyle: { fontFamily: fonts.serif, fontWeight: '700' as const, color: colors.text },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
  headerBackButtonDisplayMode: 'minimal' as const,
};

function RootNavigator() {
  const { session, ready } = useAuth();
  if (!ready) return <Loading />;
  const signedIn = session !== null;

  return (
    <Stack screenOptions={stackScreenOptions}>
      {/* Контроль доступа: без сессии экраны с данными недоступны даже по прямой ссылке */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ title: 'Регистрация' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="hero/new" options={{ title: 'Новый герой' }} />
        <Stack.Screen name="hero/[id]/index" options={{ title: 'Лист персонажа' }} />
        <Stack.Screen name="hero/[id]/edit" options={{ title: 'Редактирование' }} />
        <Stack.Screen name="campaign/new" options={{ title: 'Новое приключение' }} />
        <Stack.Screen name="campaign/[id]/edit" options={{ title: 'Приключение' }} />
        <Stack.Screen name="play/[id]" options={{ title: 'Игра' }} />
        <Stack.Screen name="backup" options={{ title: 'Резервные копии' }} />
        <Stack.Screen name="security" options={{ title: 'Безопасность' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
