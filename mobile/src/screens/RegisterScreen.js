import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const update = (key, val) => setForm({ ...form, [key]: val });

  const handleRegister = async () => {
    const { name, email, phone, password, confirm } = form;
    if (!name || !email || !phone || !password) return Alert.alert('Error', 'Please fill in all fields');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');
    if (password !== confirm) return Alert.alert('Error', 'Passwords do not match');

    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password });
    } catch (err) {
      Alert.alert('Registration Failed', err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const fields = [
    { key: 'name', label: 'Full Name', placeholder: 'John Doe', type: 'default' },
    { key: 'email', label: 'Email', placeholder: 'you@example.com', type: 'email-address' },
    { key: 'phone', label: 'Phone Number (for airtime)', placeholder: '+256771222333', type: 'phone-pad' },
    { key: 'password', label: 'Password', placeholder: 'At least 6 characters', secure: true },
    { key: 'confirm', label: 'Confirm Password', placeholder: 'Repeat password', secure: true },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.subtitle}>Start earning airtime by recycling plastic</Text>

      {fields.map((f) => (
        <View key={f.key}>
          <Text style={styles.label}>{f.label}</Text>
          <TextInput
            style={styles.input}
            value={form[f.key]}
            onChangeText={(v) => update(f.key, v)}
            placeholder={f.placeholder}
            keyboardType={f.type || 'default'}
            secureTextEntry={f.secure}
            autoCapitalize={f.key === 'email' ? 'none' : 'words'}
            placeholderTextColor="#999"
          />
        </View>
      ))}

      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.link}>
        <Text style={styles.linkText}>Already have an account? <Text style={styles.linkBold}>Log in</Text></Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0FFF0' },
  content: { padding: 24, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '700', color: '#1B5E20', marginTop: 20 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 16, color: '#333' },
  button: { backgroundColor: '#2E7D32', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 20 },
  linkText: { color: '#666', fontSize: 14 },
  linkBold: { color: '#2E7D32', fontWeight: '700' },
});
