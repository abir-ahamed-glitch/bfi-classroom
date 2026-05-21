import re

with open('src/pages/Inbox.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. State changes
code = code.replace(
    "const [attachedFile, setAttachedFile] = useState(null);",
    "const [attachedFiles, setAttachedFiles] = useState([]);"
)
code = code.replace(
    "const [attachedFilePreviewUrl, setAttachedFilePreviewUrl] = useState('');",
    ""
)

# 2. Add helpers near newMessage
helper_code = """const [newMessage, setNewMessage] = useState('');
  
  const clearAttachments = () => {
    setAttachedFiles(prev => {
      prev.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
      return [];
    });
  };

  const removeAttachment = (index) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev];
      if (newFiles[index].previewUrl) URL.revokeObjectURL(newFiles[index].previewUrl);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };"""
code = code.replace("const [newMessage, setNewMessage] = useState('');", helper_code)

# 3. Audio recording
code = code.replace(
    """setAttachedFile(file);
        setAttachedFilePreviewUrl(URL.createObjectURL(audioBlob));""",
    "setAttachedFiles([{ file, previewUrl: URL.createObjectURL(audioBlob) }]);"
)

code = code.replace(
    """setAttachedFile(null);
      setAttachedFilePreviewUrl('');""",
    "clearAttachments();"
)

# 4. Other setAttachedFile(null)
code = code.replace("setAttachedFile(null);", "clearAttachments();")

# 5. handleFilePick
old_handleFilePick = """const handleFilePick = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (chatMessagesRef.current) {
      preserveScrollTopRef.current = chatMessagesRef.current.scrollTop;
    }
    setAttachedFile(file);
    setEditingMessage(null);
  };"""

new_handleFilePick = """const handleFilePick = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    if (chatMessagesRef.current) {
      preserveScrollTopRef.current = chatMessagesRef.current.scrollTop;
    }
    const newFiles = files.map(file => ({
      file,
      previewUrl: ((file.type || '').startsWith('image/') || (file.type || '').startsWith('video/') || (file.type || '').startsWith('audio/')) ? URL.createObjectURL(file) : null
    }));
    setAttachedFiles(prev => [...prev, ...newFiles]);
    setEditingMessage(null);
    if (event.target) event.target.value = '';
  };"""
code = code.replace(old_handleFilePick, new_handleFilePick)

# 6. UseEffects
code = code.replace(
    "[attachedFile, attachedFilePreviewUrl, ",
    "[attachedFiles, "
)

code = code.replace(
    "if (!attachedFile || !(attachedFile.type || '').startsWith('image/'))",
    "if (false)"
)

# 7. renderPendingAttachmentPreview
old_render = """const renderPendingAttachmentPreview = () => {
    if (!attachedFile) return null;

    if ((attachedFile.type || '').startsWith('image/') && attachedFilePreviewUrl) {
      return (
        <div className="attachment-card image pending">
          <img src={attachedFilePreviewUrl} alt={attachedFile.name} />
        </div>
      );
    }

    if ((attachedFile.type || '').startsWith('video/') && attachedFilePreviewUrl) {
      return (
        <div className="attachment-card video pending">
          <video src={attachedFilePreviewUrl} style={{ width: '100%', maxWidth: '200px', borderRadius: '8px' }} />
        </div>
      );
    }

    if ((attachedFile.type || '').startsWith('audio/') && attachedFilePreviewUrl) {
      return (
        <div className="attachment-card audio pending" style={{ background: 'transparent', padding: 0, border: 'none', boxShadow: 'none' }}>
          <VoiceMessagePlayer src={attachedFilePreviewUrl} isMine={true} avatarUrl={currentUser?.profile_picture} />
        </div>
      );
    }

    return (
      <div className="attachment-card file pending">
        <FileText size={18} />
        <span>{attachedFile.name}</span>
      </div>
    );
  };"""

new_render = """const renderPendingAttachmentPreview = (attachment) => {
    const { file, previewUrl } = attachment;
    if (!file) return null;

    if ((file.type || '').startsWith('image/') && previewUrl) {
      return <img src={previewUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }

    if ((file.type || '').startsWith('video/') && previewUrl) {
      return <video src={previewUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }

    if ((file.type || '').startsWith('audio/') && previewUrl) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
           <Mic size={20} color="var(--text-primary)" />
        </div>
      );
    }

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
        <FileText size={20} color="var(--text-primary)" />
      </div>
    );
  };"""
code = code.replace(old_render, new_render)


# 8. sendAttachmentMessage
old_send = """const sendAttachmentMessage = async () => {
    const encryptedContent = await encryptStringForUser(newMessage || attachedFile.name);
    
    let encryptedFile;
    let attachmentType;
    let fileName;

    try {
      encryptedFile = await encryptFileE2E(attachedFile, getMyPublicKey(), getRecipientPublicKey(activeChat));
      attachmentType = `e2e-file:${attachedFile.type || 'application/octet-stream'}`;
      fileName = `${attachedFile.name}.e2e`;
    } catch (e) {
      throw new Error(e.message || 'Could not encrypt attachment for this recipient.');
    }

    const formData = new FormData();
    formData.append('receiver_id', String(activeChat.other_user_id));
    formData.append('content', encryptedContent);
    formData.append('attachment_type', attachmentType);
    if (replyToMessage?.id) {
      formData.append('reply_to_message_id', String(replyToMessage.id));
    }
    formData.append('attachment', encryptedFile, fileName);

    const response = await apiFetch('/api/inbox/messages/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: formData,
    });

    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || 'Failed to send attachment.');

    if (data.sent_message) {
      const processed = (await processIncomingMessages([data.sent_message]))[0];
      forceScrollToLatest();
      setMessages((prev) => prev.some((item) => item.id === processed.id) ? prev : [...prev, processed]);
    }
    resetComposerContext();
    fetchConversations(activeChat.other_user_id, { silent: true });
  };"""

new_send = """const sendAttachmentMessage = async () => {
    const textToSend = newMessage;
    setNewMessage('');
    
    let sentAny = false;
    for (let i = 0; i < attachedFiles.length; i++) {
      const { file } = attachedFiles[i];
      const textForThis = (i === 0 && textToSend) ? textToSend : file.name;
      const encryptedContent = await encryptStringForUser(textForThis);
      
      let encryptedFile;
      let attachmentType;
      let fileName;

      try {
        encryptedFile = await encryptFileE2E(file, getMyPublicKey(), getRecipientPublicKey(activeChat));
        attachmentType = `e2e-file:${file.type || 'application/octet-stream'}`;
        fileName = `${file.name}.e2e`;
      } catch (e) {
        throw new Error(e.message || 'Could not encrypt attachment for this recipient.');
      }

      const formData = new FormData();
      formData.append('receiver_id', String(activeChat.other_user_id));
      formData.append('content', encryptedContent);
      formData.append('attachment_type', attachmentType);
      if (replyToMessage?.id && i === 0) {
        formData.append('reply_to_message_id', String(replyToMessage.id));
      }
      formData.append('attachment', encryptedFile, fileName);

      const response = await apiFetch('/api/inbox/messages/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to send attachment.');

      if (data.sent_message) {
        const processed = (await processIncomingMessages([data.sent_message]))[0];
        forceScrollToLatest();
        setMessages((prev) => prev.some((item) => item.id === processed.id) ? prev : [...prev, processed]);
        sentAny = true;
      }
    }
    
    if (sentAny) {
      clearAttachments();
      fetchConversations(activeChat.other_user_id, { silent: true });
    }
  };"""
code = code.replace(old_send, new_send)

# 9. submitMessage
code = code.replace("if (!newMessage.trim() && !attachedFile && !editingMessage) return;", "if (!newMessage.trim() && attachedFiles.length === 0 && !editingMessage) return;")
code = code.replace("if (attachedFile) {", "if (attachedFiles.length > 0) {")

# 10. JSX
old_jsx = """{attachedFile && (
                          <div className="fb-attachment-preview-row">
                            <button type="button" className="fb-add-more-btn" onClick={() => fileInputRef.current?.click()}>
                              <ImageIcon size={24} color="#65676b" />
                            </button>
                            <div className="fb-attachment-thumbnail-wrapper">
                              <div className="fb-attachment-thumbnail">
                                {renderPendingAttachmentPreview()}
                              </div>
                              <button type="button" className="fb-attachment-close" onClick={resetComposerContext}>
                                <X size={14} strokeWidth={3} />
                              </button>
                            </div>
                          </div>
                        )}"""

new_jsx = """{attachedFiles.length > 0 && (
                          <div className="fb-attachment-preview-row">
                            <button type="button" className="fb-add-more-btn" onClick={() => fileInputRef.current?.click()}>
                              <Plus size={24} color="#65676b" />
                            </button>
                            {attachedFiles.map((att, idx) => (
                              <div key={idx} className="fb-attachment-thumbnail-wrapper">
                                <div className="fb-attachment-thumbnail">
                                  {renderPendingAttachmentPreview(att)}
                                </div>
                                <button type="button" className="fb-attachment-close" onClick={() => removeAttachment(idx)}>
                                  <X size={12} strokeWidth={3} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}"""
code = code.replace(old_jsx, new_jsx)

code = code.replace("(!newMessage.trim() && !attachedFile && !isRecording)", "(!newMessage.trim() && attachedFiles.length === 0 && !isRecording)")
code = code.replace("className={`fb-icon-btn ${attachedFile ? 'active' : ''}`}", "className={`fb-icon-btn ${attachedFiles.length > 0 ? 'active' : ''}`}")
code = code.replace("title={attachedFile ? 'Change attachment' : 'Attach photo'}", "title='Attach photo'")
code = code.replace("placeholder={editingMessage ? 'Update your message...' : attachedFile ? 'Add a caption...' : 'Aa'}", "placeholder={editingMessage ? 'Update your message...' : attachedFiles.length > 0 ? 'Add a caption...' : 'Aa'}")
code = code.replace("{newMessage.trim() || attachedFile ?", "{newMessage.trim() || attachedFiles.length > 0 ?")

# 11. CSS
code = code.replace(".fb-input:focus {", ".fb-input:focus {\n          border: none !important;\n          box-shadow: none !important;\n          outline: none !important;")

# 12. Input multiple
code = code.replace('<input ref={fileInputRef} type="file" style={{ display: \'none\' }} onChange={handleFilePick} />', '<input ref={fileInputRef} type="file" multiple style={{ display: \'none\' }} onChange={handleFilePick} />')

with open('src/pages/Inbox.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Done migration in python")
