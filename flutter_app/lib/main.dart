import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:8000',
);

void main() => runApp(const Track2CollegeApp());

class Track2CollegeApp extends StatelessWidget {
  const Track2CollegeApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Track2College',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF356B5A),
            brightness: Brightness.light,
            surface: const Color(0xFFF8F8F4),
          ),
          scaffoldBackgroundColor: const Color(0xFFF8F8F4),
          fontFamily: 'Roboto',
        ),
        home: const ChatPage(),
      );
}

class ChatMessage {
  ChatMessage({required this.text, required this.fromUser, this.sources = const []});
  final String text;
  final bool fromUser;
  final List<String> sources;
}

class ChatPage extends StatefulWidget {
  const ChatPage({super.key});
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _http = http.Client();
  final List<ChatMessage> _messages = [];
  String? _sessionId;
  bool _sending = false;
  String? _error;

  Future<Map<String, dynamic>> _request(String path,
      {String method = 'GET', Map<String, Object?>? body}) async {
    final uri = Uri.parse('$apiBaseUrl$path');
    final response = await _http
        .send(http.Request(method, uri)
          ..headers['Accept'] = 'application/json'
          ..headers['Content-Type'] = 'application/json'
          ..body = body == null ? '' : jsonEncode(body))
        .timeout(const Duration(minutes: 4));
    final text = await response.stream.transform(utf8.decoder).join();
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final detail = decoded['detail']?.toString() ?? 'Request failed (${response.statusCode})';
      throw Exception(detail);
    }
    return decoded;
  }

  Future<void> _send([String? suggested]) async {
    final question = (suggested ?? _controller.text).trim();
    if (question.isEmpty || _sending) return;
    setState(() {
      _controller.clear();
      _error = null;
      _sending = true;
      _messages.add(ChatMessage(text: question, fromUser: true));
    });
    _scrollToBottom();
    try {
      final result = await _request('/chat', method: 'POST', body: {
        'query': question,
        if (_sessionId != null) 'session_id': _sessionId,
      });
      if (!mounted) return;
      setState(() {
        _sessionId = result['session_id'] as String? ?? _sessionId;
        _messages.add(ChatMessage(
          text: result['answer']?.toString() ?? 'I could not create an answer.',
          fromUser: false,
          sources: (result['sources'] as List? ?? []).map((source) => source.toString()).toList(),
        ));
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => _sending = false);
        _scrollToBottom();
      }
    }
  }

  Future<void> _clearChat() async {
    final session = _sessionId;
    if (session != null) {
      try {
        await _request('/chat/${Uri.encodeComponent(session)}', method: 'DELETE');
      } catch (_) {
        // The local conversation can still be cleared if the service is offline.
      }
    }
    if (!mounted) return;
    setState(() {
      _sessionId = null;
      _messages.clear();
      _error = null;
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(_scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _http.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFFF8F8F4),
        surfaceTintColor: Colors.transparent,
        titleSpacing: 20,
        title: Row(children: [
          Container(
            width: 42, height: 42,
            decoration: BoxDecoration(color: const Color(0xFFE3EEE8), borderRadius: BorderRadius.circular(14)),
            child: const Icon(Icons.school_rounded, color: Color(0xFF356B5A)),
          ),
          const SizedBox(width: 12),
          const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Track2College', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            Text('Your college planning guide', style: TextStyle(fontSize: 12, color: Color(0xFF72766F))),
          ]),
        ]),
        actions: [
          IconButton(tooltip: 'New chat', onPressed: _messages.isEmpty ? null : _clearChat,
              icon: const Icon(Icons.add_comment_outlined)),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(children: [
        Expanded(child: _messages.isEmpty ? _welcome(colors) : _conversation()),
        if (_error != null) _errorBanner(_error!),
        _composer(colors),
      ]),
    );
  }

  Widget _welcome(ColorScheme colors) => Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 30),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 56, height: 56,
                decoration: BoxDecoration(color: const Color(0xFFE3EEE8), borderRadius: BorderRadius.circular(18)),
                child: const Icon(Icons.waving_hand_rounded, size: 28, color: Color(0xFF356B5A))),
              const SizedBox(height: 24),
              const Text('A clearer path to\nyour college future.',
                  style: TextStyle(fontSize: 34, height: 1.12, fontWeight: FontWeight.w700, letterSpacing: -0.8)),
              const SizedBox(height: 12),
              const Text('Ask about admissions, financial aid, scholarships, and planning your next steps.',
                  style: TextStyle(fontSize: 15, height: 1.55, color: Color(0xFF696E68))),
              const SizedBox(height: 28),
              const Text('TRY ASKING', style: TextStyle(fontSize: 11, letterSpacing: 1.2, fontWeight: FontWeight.w700, color: Color(0xFF777D76))),
              const SizedBox(height: 12),
              _prompt('How do I build a college application timeline?', Icons.calendar_month_outlined),
              _prompt('What financial aid should I apply for?', Icons.savings_outlined),
              _prompt('How can I find scholarships for college?', Icons.workspace_premium_outlined),
            ]),
          ),
        ),
      );

  Widget _prompt(String text, IconData icon) => Padding(
        padding: const EdgeInsets.only(bottom: 9),
        child: Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(15),
          child: InkWell(
            borderRadius: BorderRadius.circular(15),
            onTap: _sending ? null : () => _send(text),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 14), child: Row(children: [
              Icon(icon, size: 19, color: const Color(0xFF477461)),
              const SizedBox(width: 12),
              Expanded(child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500))),
              const Icon(Icons.arrow_outward_rounded, size: 16, color: Color(0xFF929890)),
            ])),
          ),
        ),
      );

  Widget _conversation() => ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
        itemCount: _messages.length + (_sending ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == _messages.length) return _typingIndicator();
          return _messageBubble(_messages[index]);
        },
      );

  Widget _messageBubble(ChatMessage message) {
    final user = message.fromUser;
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 680),
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: BoxDecoration(
          color: user ? const Color(0xFF356B5A) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18), topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(user ? 18 : 5), bottomRight: Radius.circular(user ? 5 : 18),
          ),
          boxShadow: user ? null : [BoxShadow(color: Colors.black.withValues(alpha: 0.035), blurRadius: 10, offset: const Offset(0, 3))],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SelectableText(message.text, style: TextStyle(color: user ? Colors.white : const Color(0xFF292D29), fontSize: 14.5, height: 1.55)),
          if (message.sources.isNotEmpty) ...[
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 10),
            const Text('SOURCES', style: TextStyle(fontSize: 10, letterSpacing: 1, fontWeight: FontWeight.w700, color: Color(0xFF747A73))),
            const SizedBox(height: 6),
            ...message.sources.map((source) => Padding(
              padding: const EdgeInsets.only(top: 5),
              child: SelectableText(source, style: const TextStyle(fontSize: 12, color: Color(0xFF356B5A), decoration: TextDecoration.underline)),
            )),
          ],
        ]),
      ),
    );
  }

  Widget _typingIndicator() => Align(alignment: Alignment.centerLeft, child: Container(
        margin: const EdgeInsets.only(bottom: 14), padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 15),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
        child: const SizedBox(width: 42, height: 14, child: LinearProgressIndicator(minHeight: 3)),
      ));

  Widget _errorBanner(String error) => Container(
        width: double.infinity, margin: const EdgeInsets.fromLTRB(16, 0, 16, 8), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFFFEEEE), borderRadius: BorderRadius.circular(12)),
        child: Text('$error\nCheck that the API is running at $apiBaseUrl.', style: const TextStyle(color: Color(0xFF9D3434), fontSize: 12)),
      );

  Widget _composer(ColorScheme colors) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Center(child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Container(
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.07), blurRadius: 22, offset: const Offset(0, 6))]),
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Expanded(child: TextField(
                  controller: _controller,
                  minLines: 1, maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(
                    hintText: 'Ask about college planning…',
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.fromLTRB(18, 17, 8, 17),
                  ),
                )),
                Padding(padding: const EdgeInsets.all(7), child: IconButton.filled(
                  onPressed: _sending ? null : () => _send(),
                  style: IconButton.styleFrom(backgroundColor: const Color(0xFF356B5A), foregroundColor: Colors.white),
                  icon: Icon(_sending ? Icons.hourglass_top_rounded : Icons.arrow_upward_rounded),
                  tooltip: 'Send message',
                )),
              ]),
            ),
          )),
        ),
      );
}
