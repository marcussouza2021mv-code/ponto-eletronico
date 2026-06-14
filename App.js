
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Alert, ActivityIndicator,
  ScrollView
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const API = 'https://ponto-eletronico-p6t6.onrender.com';
const LARANJA = '#F15A24';

function TelaLogin({ onLogin }) {
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    if (!matricula || !senha) { Alert.alert('Atenção', 'Preencha matrícula e senha.'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula, senha })
      });
      const d = await r.json();
      if (d.erro) { Alert.alert('Erro', d.erro); }
      else { onLogin(d.token, d.colaborador); }
    } catch (e) {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor={LARANJA} />
      <View style={s.loginBox}>
        <View style={s.logoArea}>
          <Text style={s.logoMed}>med<Text style={{ color: LARANJA }}>+</Text></Text>
          <Text style={s.logoGroup}>GROUP</Text>
          <Text style={s.logoSub}>Ponto Eletrônico</Text>
        </View>
        <TextInput style={s.input} placeholder="Matrícula" placeholderTextColor="#999" value={matricula} onChangeText={setMatricula} autoCapitalize="none" />
        <TextInput style={s.input} placeholder="Senha" placeholderTextColor="#999" value={senha} onChangeText={setSenha} secureTextEntry />
        <TouchableOpacity style={s.btnLogin} onPress={login} disabled={loading}>
          {loading ? <ActivityIndicator color={LARANJA} /> : <Text style={s.btnLoginText}>Entrar</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function TelaHome({ token, usuario, onSair, onRegistrar }) {
  const [pontos, setPontos] = useState([]);
  const [loading, setLoading] = useState(true);
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  useEffect(() => { carregarPontos(); }, []);

  async function carregarPontos() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/ponto/hoje/${usuario.matricula}`, { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      setPontos(d.registros || []);
    } catch (e) {}
    setLoading(false);
  }

  const labels = ['Entrada', 'Saída Almoço', 'Retorno Almoço', 'Saída'];
  const icons = ['🟢', '🟡', '🔵', '🔴'];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f8f8' }}>
      <StatusBar barStyle="light-content" backgroundColor={LARANJA} />
      <View style={s.header}>
        <View>
          <Text style={s.headerLogo}>med<Text style={{ color: '#FFD0C0' }}>+</Text> GROUP</Text>
          <Text style={s.headerSub}>Ponto Eletrônico</Text>
        </View>
        <TouchableOpacity onPress={onSair} style={s.btnSair}>
          <Text style={s.btnSairText}>Sair</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={s.cardHora}>
          <Text style={s.horaTexto}>{hora}</Text>
          <Text style={s.dataTexto}>{data}</Text>
          <Text style={s.nomeTexto}>Olá, {usuario.nome?.split(' ')[0]}!</Text>
        </View>
        <TouchableOpacity style={s.btnPonto} onPress={onRegistrar}>
          <Text style={s.btnPontoIcon}>👆</Text>
          <Text style={s.btnPontoText}>REGISTRAR PONTO</Text>
          <Text style={s.btnPontoSub}>Toque para bater o ponto</Text>
        </TouchableOpacity>
        <View style={s.cardPontos}>
          <Text style={s.cardTitulo}>Registros de Hoje</Text>
          {loading ? <ActivityIndicator color={LARANJA} style={{ marginTop: 16 }} /> : pontos.length === 0 ? <Text style={s.semPontos}>Nenhum registro hoje.</Text> : pontos.map((p, i) => (
            <View key={i} style={s.pontoItem}>
              <Text style={s.pontoIcon}>{icons[i] || '⚪'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pontoLabel}>{labels[i] || `Ponto ${i + 1}`}</Text>
                <Text style={s.pontoHora}>{new Date(p.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
              <Text style={[s.pontoStatus, { color: p.reconhecimento_facial ? '#4CAF50' : '#FF9800' }]}>{p.reconhecimento_facial ? '✓ Facial' : '📍 Manual'}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity onPress={carregarPontos} style={s.btnAtualizar}>
          <Text style={s.btnAtualizarText}>↻ Atualizar registros</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function TelaCamera({ token, usuario, onVoltar, onSucesso }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef(null);

  async function tirarFoto() {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const foto = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      const r = await fetch(`${API}/ponto/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ matricula: usuario.matricula, foto_base64: foto.base64 })
      });
      const d = await r.json();
      setCapturing(false);
      if (d.sucesso) {
        Alert.alert('✅ Ponto Registrado!', `${d.tipo_registro}\n${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, [{ text: 'OK', onPress: onSucesso }]);
      } else {
        Alert.alert('Erro', d.erro || 'Não foi possível registrar.', [{ text: 'Tentar novamente' }, { text: 'Voltar', onPress: onVoltar }]);
      }
    } catch (e) {
      setCapturing(false);
      Alert.alert('Erro', 'Verifique sua internet.');
    }
  }

  if (!permission) return <View style={s.container}><ActivityIndicator color={LARANJA} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.container}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📷</Text>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>Permissão de Câmera</Text>
          <Text style={{ color: '#FFD0C0', textAlign: 'center', marginBottom: 24 }}>Precisamos da câmera para reconhecimento facial.</Text>
          <TouchableOpacity style={s.btnLogin} onPress={requestPermission}>
            <Text style={s.btnLoginText}>Permitir câmera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onVoltar} style={{ marginTop: 12 }}>
            <Text style={{ color: '#FFD0C0' }}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="front" ref={cameraRef}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={s.cameraHeader}>
            <TouchableOpacity onPress={onVoltar} style={s.btnVoltar}>
              <Text style={{ color: '#fff', fontSize: 16 }}>← Voltar</Text>
            </TouchableOpacity>
            <Text style={s.cameraTitulo}>Reconhecimento Facial</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={s.oval} />
            <Text style={s.cameraInstrucao}>Centralize seu rosto no oval</Text>
          </View>
          <View style={s.cameraFooter}>
            <TouchableOpacity style={[s.btnCapturar, capturing && { opacity: 0.6 }]} onPress={tirarFoto} disabled={capturing}>
              {capturing ? <ActivityIndicator color={LARANJA} size="large" /> : <View style={s.btnCapturarInner} />}
            </TouchableOpacity>
            <Text style={{ color: '#fff', marginTop: 12, fontSize: 13 }}>{capturing ? 'Registrando ponto...' : 'Toque para registrar'}</Text>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

export default function App() {
  const [tela, setTela] = useState('login');
  const [token, setToken] = useState(null);
  const [usuario, setUsuario] = useState(null);

  return tela === 'login' ? <TelaLogin onLogin={(t, u) => { setToken(t); setUsuario(u); setTela('home'); }} /> :
    tela === 'home' ? <TelaHome token={token} usuario={usuario} onSair={() => { setToken(null); setUsuario(null); setTela('login'); }} onRegistrar={() => setTela('camera')} /> :
    <TelaCamera token={token} usuario={usuario} onVoltar={() => setTela('home')} onSucesso={() => setTela('home')} />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: LARANJA },
  loginBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  logoArea: { alignItems: 'center', marginBottom: 40 },
  logoMed: { fontSize: 56, fontWeight: '900', color: '#fff', letterSpacing: -2 },
  logoGroup: { fontSize: 12, color: '#FFD0C0', fontWeight: '700', letterSpacing: 6, marginTop: -8 },
  logoSub: { fontSize: 14, color: '#FFD0C0', marginTop: 8 },
  input: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 14, color: '#222' },
  btnLogin: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 6 },
  btnLoginText: { color: LARANJA, fontWeight: '800', fontSize: 16 },
  header: { backgroundColor: LARANJA, paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLogo: { fontSize: 18, fontWeight: '900', color: '#fff' },
  headerSub: { fontSize: 11, color: '#FFD0C0' },
  btnSair: { borderWidth: 1.5, borderColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  btnSairText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  cardHora: { backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16, elevation: 3 },
  horaTexto: { fontSize: 52, fontWeight: '900', color: LARANJA },
  dataTexto: { fontSize: 13, color: '#888', marginTop: 4, textTransform: 'capitalize' },
  nomeTexto: { fontSize: 15, color: '#444', marginTop: 8, fontWeight: '600' },
  btnPonto: { backgroundColor: LARANJA, borderRadius: 16, padding: 28, alignItems: 'center', marginBottom: 16, elevation: 6 },
  btnPontoIcon: { fontSize: 36, marginBottom: 8 },
  btnPontoText: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  btnPontoSub: { color: '#FFD0C0', fontSize: 12, marginTop: 4 },
  cardPontos: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, elevation: 3 },
  cardTitulo: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 12 },
  semPontos: { color: '#aaa', textAlign: 'center', padding: 16 },
  pontoItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  pontoIcon: { fontSize: 20, marginRight: 12 },
  pontoLabel: { fontSize: 13, color: '#666' },
  pontoHora: { fontSize: 18, fontWeight: '700', color: '#222' },
  pontoStatus: { fontSize: 11, fontWeight: '600' },
  btnAtualizar: { alignItems: 'center', padding: 12 },
  btnAtualizarText: { color: LARANJA, fontWeight: '600' },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 },
  btnVoltar: { padding: 8 },
  cameraTitulo: { color: '#fff', fontWeight: '700', fontSize: 16 },
  oval: { width: 220, height: 280, borderRadius: 110, borderWidth: 3, borderColor: LARANJA, borderStyle: 'dashed' },
  cameraInstrucao: { color: '#fff', marginTop: 16, fontSize: 14, opacity: 0.85 },
  cameraFooter: { alignItems: 'center', paddingBottom: 40 },
  btnCapturar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnCapturarInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: LARANJA },
});
