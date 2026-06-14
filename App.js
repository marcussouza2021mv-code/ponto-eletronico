import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const API = 'https://ponto-eletronico-p6t6.onrender.com';
const LARANJA = '#F15A24';

// ─── TELA INICIAL ─────────────────────────────────────────
function TelaInicial({ onRegistrar, onCadastrar }) {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: LARANJA }}>
      <StatusBar barStyle="light-content" backgroundColor={LARANJA} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={s.logoMed}>med<Text style={{ color: '#fff' }}>+</Text></Text>
        <Text style={s.logoGroup}>GROUP</Text>
        <Text style={{ color: '#FFD0C0', fontSize: 13, marginTop: 4 }}>Ponto Eletrônico</Text>
        <View style={s.cardHora}>
          <Text style={s.horaTexto}>{hora}</Text>
          <Text style={s.dataTexto}>{data}</Text>
        </View>
        <TouchableOpacity style={s.btnPrincipal} onPress={onRegistrar}>
          <Text style={{ fontSize: 36 }}>😊</Text>
          <Text style={s.btnPrincipalTexto}>REGISTRAR PONTO</Text>
          <Text style={s.btnPrincipalSub}>Reconhecimento facial</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnSecundario} onPress={onCadastrar}>
          <Text style={s.btnSecundarioTexto}>Primeiro acesso? Cadastrar rosto</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── TELA CADASTRO FACIAL (primeiro acesso) ───────────────
function TelaCadastro({ onVoltar }) {
  const [cpf, setCpf] = useState('');
  const [etapa, setEtapa] = useState('cpf');
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef(null);

  function formatarCpf(v) {
    const n = v.replace(/\D/g, '').slice(0, 11);
    return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            .replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')
            .replace(/(\d{3})(\d{3})/, '$1.$2')
            .replace(/(\d{3})/, '$1');
  }

  async function confirmarCpf() {
    if (cpf.replace(/\D/g, '').length < 11) { Alert.alert('Atenção', 'Digite um CPF válido.'); return; }
    if (!permission?.granted) { await requestPermission(); }
    setEtapa('camera');
  }

  async function tirarFoto() {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const foto = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      const r = await fetch(`${API}/facial/cadastrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, ''), foto_base64: foto.base64 })
      });
      const d = await r.json();
      setCapturing(false);
      if (d.sucesso) {
        Alert.alert('✅ Cadastro Realizado!', d.mensagem, [{ text: 'OK', onPress: onVoltar }]);
      } else {
        Alert.alert('Erro', d.erro || 'Não foi possível cadastrar.', [{ text: 'Tentar novamente' }, { text: 'Voltar', onPress: onVoltar }]);
      }
    } catch (e) {
      setCapturing(false);
      Alert.alert('Erro de conexão', 'Verifique sua internet.');
    }
  }

  if (etapa === 'cpf') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: LARANJA }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>👤</Text>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 8 }}>Primeiro Acesso</Text>
          <Text style={{ color: '#FFD0C0', textAlign: 'center', marginBottom: 32, fontSize: 14 }}>Digite seu CPF para cadastrar seu rosto no sistema.</Text>
          <TextInput
            style={s.input}
            placeholder="000.000.000-00"
            placeholderTextColor="#999"
            value={cpf}
            onChangeText={v => setCpf(formatarCpf(v))}
            keyboardType="numeric"
            maxLength={14}
          />
          <TouchableOpacity style={s.btnLogin} onPress={confirmarCpf}>
            <Text style={s.btnLoginTexto}>Continuar →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onVoltar} style={{ marginTop: 20 }}>
            <Text style={{ color: '#FFD0C0', fontSize: 14 }}>← Voltar</Text>
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
            <TouchableOpacity onPress={() => setEtapa('cpf')}><Text style={{ color: '#fff', fontSize: 16 }}>← Voltar</Text></TouchableOpacity>
            <Text style={s.cameraTitulo}>Cadastrar Rosto</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={s.oval} />
            <Text style={s.cameraInstrucao}>Centralize seu rosto e tire a foto</Text>
          </View>
          <View style={s.cameraFooter}>
            <TouchableOpacity style={[s.btnCapturar, capturing && { opacity: 0.6 }]} onPress={tirarFoto} disabled={capturing}>
              {capturing ? <ActivityIndicator color={LARANJA} size="large" /> : <View style={s.btnCapturarInner} />}
            </TouchableOpacity>
            <Text style={{ color: '#fff', marginTop: 12, fontSize: 13 }}>{capturing ? 'Cadastrando...' : 'Toque para fotografar'}</Text>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

// ─── TELA REGISTRO DE PONTO (facial) ─────────────────────
function TelaRegistro({ onVoltar }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [resultado, setResultado] = useState(null);
  const cameraRef = useRef(null);

  async function tirarFoto() {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const foto = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      const r = await fetch(`${API}/ponto/facial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_base64: foto.base64 })
      });
      const d = await r.json();
      setCapturing(false);
      if (d.sucesso) {
        setResultado(d);
      } else {
        Alert.alert('Não reconhecido', d.erro || 'Rosto não encontrado.', [{ text: 'Tentar novamente' }, { text: 'Voltar', onPress: onVoltar }]);
      }
    } catch (e) {
      setCapturing(false);
      Alert.alert('Erro de conexão', 'Verifique sua internet.');
    }
  }

  if (resultado) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f8f8', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View style={s.cardSucesso}>
          <Text style={{ fontSize: 64 }}>✅</Text>
          <Text style={s.sucessoTitulo}>Ponto Registrado!</Text>
          <Text style={s.sucessoNome}>{resultado.colaborador.nome}</Text>
          <Text style={s.sucessoCargo}>{resultado.colaborador.cargo}</Text>
          <View style={s.badgeTipo}><Text style={s.badgeTipoTexto}>{resultado.tipo_registro}</Text></View>
          <Text style={s.sucessoHora}>{resultado.hora}</Text>
          <Text style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>Registro {resultado.total_registros_hoje} de hoje</Text>
        </View>
        <TouchableOpacity style={[s.btnLogin, { marginTop: 24, backgroundColor: LARANJA }]} onPress={onVoltar}>
          <Text style={[s.btnLoginTexto, { color: '#fff' }]}>Concluir</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: LARANJA, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>📷</Text>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>Permissão de Câmera</Text>
        <Text style={{ color: '#FFD0C0', textAlign: 'center', marginBottom: 24 }}>Precisamos da câmera para reconhecimento facial.</Text>
        <TouchableOpacity style={s.btnLogin} onPress={requestPermission}>
          <Text style={s.btnLoginTexto}>Permitir câmera</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onVoltar} style={{ marginTop: 12 }}>
          <Text style={{ color: '#FFD0C0' }}>Voltar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="front" ref={cameraRef}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={s.cameraHeader}>
            <TouchableOpacity onPress={onVoltar}><Text style={{ color: '#fff', fontSize: 16 }}>← Voltar</Text></TouchableOpacity>
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
            <Text style={{ color: '#fff', marginTop: 12, fontSize: 13 }}>{capturing ? 'Identificando...' : 'Toque para registrar'}</Text>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────
export default function App() {
  const [tela, setTela] = useState('inicial');
  return tela === 'inicial' ? <TelaInicial onRegistrar={() => setTela('registro')} onCadastrar={() => setTela('cadastro')} /> :
    tela === 'registro' ? <TelaRegistro onVoltar={() => setTela('inicial')} /> :
    <TelaCadastro onVoltar={() => setTela('inicial')} />;
}

// ─── ESTILOS ──────────────────────────────────────────────
const s = StyleSheet.create({
  logoMed: { fontSize: 52, fontWeight: '900', color: '#fff', letterSpacing: -2 },
  logoGroup: { fontSize: 11, color: '#FFD0C0', fontWeight: '700', letterSpacing: 6, marginTop: -8 },
  cardHora: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 20, alignItems: 'center', marginVertical: 28, width: '100%' },
  horaTexto: { fontSize: 52, fontWeight: '900', color: '#fff' },
  dataTexto: { fontSize: 13, color: '#FFD0C0', marginTop: 4, textTransform: 'capitalize' },
  btnPrincipal: { backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', width: '100%', marginBottom: 14 },
  btnPrincipalTexto: { color: LARANJA, fontSize: 20, fontWeight: '900', letterSpacing: 1, marginTop: 8 },
  btnPrincipalSub: { color: '#aaa', fontSize: 12, marginTop: 4 },
  btnSecundario: { paddingVertical: 12 },
  btnSecundarioTexto: { color: '#FFD0C0', fontSize: 13, textDecorationLine: 'underline' },
  input: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 14, color: '#222' },
  btnLogin: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnLoginTexto: { color: LARANJA, fontWeight: '800', fontSize: 16 },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 },
  cameraTitulo: { color: '#fff', fontWeight: '700', fontSize: 16 },
  oval: { width: 220, height: 280, borderRadius: 110, borderWidth: 3, borderColor: LARANJA, borderStyle: 'dashed' },
  cameraInstrucao: { color: '#fff', marginTop: 16, fontSize: 14, opacity: 0.85 },
  cameraFooter: { alignItems: 'center', paddingBottom: 40 },
  btnCapturar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  btnCapturarInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: LARANJA },
  cardSucesso: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', width: '100%', elevation: 4 },
  sucessoTitulo: { fontSize: 22, fontWeight: '900', color: '#222', marginTop: 12 },
  sucessoNome: { fontSize: 20, fontWeight: '700', color: LARANJA, marginTop: 8 },
  sucessoCargo: { fontSize: 14, color: '#888', marginTop: 4 },
  badgeTipo: { backgroundColor: '#FFF0EB', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginTop: 16 },
  badgeTipoTexto: { color: LARANJA, fontWeight: '700', fontSize: 14 },
  sucessoHora: { fontSize: 42, fontWeight: '900', color: '#222', marginTop: 12 },
});
