const fs = require('fs');
let code = fs.readFileSync('src/pages/Inbox.jsx', 'utf8');

// 1. State changes
code = code.replace(/const \[attachedFile, setAttachedFile\] = useState\(null\);/g, 'const [attachedFiles, setAttachedFiles] = useState([]);');
code = code.replace(/const \[attachedFilePreviewUrl, setAttachedFilePreviewUrl\] = useState\(''\);/g, '');

// 2. clearAttachments helper
const helperCode = `
  const clearAttachments = () => {
    attachedFiles.forEach(f => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setAttachedFiles([]);
  };

  const removeAttachment = (index) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev];
      if (newFiles[index].previewUrl) URL.revokeObjectURL(newFiles[index].previewUrl);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };
`;
code = code.replace(/const \[newMessage, setNewMessage\] = useState\(''\);/, 'const [newMessage, setNewMessage] = useState(\'\');\n' + helperCode);

// 3. handleFilePick
const handleFilePickOriginal = `  const handleFilePick = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (chatMessagesRef.current) {
      preserveScrollTopRef.current = chatMessagesRef.current.scrollTop;
    }
    setAttachedFile(file);
    setEditingMessage(null);
  };`;
const handleFilePickNew = `  const handleFilePick = (event) => {
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
  };`;
code = code.replace(handleFilePickOriginal, handleFilePickNew);

// 4. Update references to setAttachedFile(null) and setAttachedFilePreviewUrl('')
code = code.replace(/setAttachedFile\(null\);/g, 'clearAttachments();');
code = code.replace(/setAttachedFilePreviewUrl\(''\);/g, '');
code = code.replace(/setAttachedFilePreviewUrl\(.*?\);/g, '');

// 5. Audio recording fix
code = code.replace(/setAttachedFile\(file\);/, 'setAttachedFiles([{ file, previewUrl: URL.createObjectURL(audioBlob) }]);');

// 6. Fix use effects that mention attachedFile
code = code.replace(/\[attachedFile, attachedFilePreviewUrl, /g, '[attachedFiles, ');
code = code.replace(/\[attachedFile\]/g, '[attachedFiles]');

// 7. Remove the old useEffect that creates Object URL
const oldUseEffect = `  useEffect(() => {
    if (!attachedFile || !(attachedFile.type || '').startsWith('image/')) {
      setAttachedFilePreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(attachedFile);
    setAttachedFilePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [attachedFile]);`;
code = code.replace(oldUseEffect, '');

// 8. Fix the renderPendingAttachmentPreview mapping
const oldRenderPreview = `  const renderPendingAttachmentPreview = () => {
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
  };`;

const newRenderPreview = `  const renderPendingAttachmentPreview = (attachment) => {
    const { file, previewUrl } = attachment;
    if (!file) return null;

    if ((file.type || '').startsWith('image/') && previewUrl) {
      return (
        <img src={previewUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      );
    }

    if ((file.type || '').startsWith('video/') && previewUrl) {
      return (
        <video src={previewUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      );
    }

    if ((file.type || '').startsWith('audio/') && previewUrl) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333' }}>
           <Mic size={20} color="white" />
        </div>
      );
    }

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333' }}>
        <FileText size={20} color="white" />
      </div>
    );
  };`;
code = code.replace(oldRenderPreview, newRenderPreview);

// 9. Fix sendAttachmentMessage
const oldSendAttachment = `  const sendAttachmentMessage = async () => {
    const encryptedContent = await encryptStringForUser(newMessage || attachedFile.name);
    
    let encryptedFile;
    let attachmentType;
    let fileName;

    try {
      encryptedFile = await encryptFileE2E(attachedFile, getMyPublicKey(), getRecipientPublicKey(activeChat));
      attachmentType = \`e2e-file:\${attachedFile.type || 'application/octet-stream'}\`;
      fileName = \`\${attachedFile.name}.e2e\`;
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
        Authorization: \`Bearer \${localStorage.getItem('token')}\`,
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
    clearAttachments();
    fetchConversations(activeChat.other_user_id, { silent: true });
  };`;

const newSendAttachment = `  const sendAttachmentMessage = async () => {
    const textToSend = newMessage;
    setNewMessage('');
    
    let sentAny = false;
    
    for (let i = 0; i < attachedFiles.length; i++) {
      const { file } = attachedFiles[i];
      const contentForThis = (i === 0 && textToSend) ? textToSend : file.name;
      const encryptedContent = await encryptStringForUser(contentForThis);
      
      let encryptedFile;
      let attachmentType;
      let fileName;

      try {
        encryptedFile = await encryptFileE2E(file, getMyPublicKey(), getRecipientPublicKey(activeChat));
        attachmentType = \`e2e-file:\${file.type || 'application/octet-stream'}\`;
        fileName = \`\${file.name}.e2e\`;
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
          Authorization: \`Bearer \${localStorage.getItem('token')}\`,
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
  };`;
code = code.replace(oldSendAttachment, newSendAttachment);

// 10. Update JSX usages
code = code.replace(/attachedFile \?/g, 'attachedFiles.length > 0 ?');
code = code.replace(/!attachedFile/g, 'attachedFiles.length === 0');
code = code.replace(/ attachedFile /g, ' attachedFiles.length > 0 ');
code = code.replace(/attachedFile \|\|/g, 'attachedFiles.length > 0 ||');
code = code.replace(/attachedFile &&/g, 'attachedFiles.length > 0 &&');

const oldJsxPreview = `{attachedFiles.length > 0 && (
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
                        )}`;

const newJsxPreview = `{attachedFiles.length > 0 && (
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
                        )}`;
code = code.replace(oldJsxPreview, newJsxPreview);

// 11. Add multiple attribute to file input
code = code.replace(/<input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFilePick} \/>/, '<input ref={fileInputRef} type="file" multiple style={{ display: \'none\' }} onChange={handleFilePick} />');

// 12. Fix fb-input:focus CSS
code = code.replace(/\\.fb-input \\{\\n\\s*flex: 1;\\n\\s*border: none;\\n\\s*background: transparent;\\n\\s*outline: none;\\n\\s*font-size: 15px;\\n\\s*padding: 6px 0;\\n\\s*color: var\\(--text-primary\\);\\n\\s*\\}/, \`\.fb-input {
          flex: 1;
          border: none;
          background: transparent;
          outline: none;
          font-size: 15px;
          padding: 6px 0;
          color: var(--text-primary);
        }
        .fb-input:focus {
          border: none !important;
          box-shadow: none !important;
          outline: none !important;
        }\`);

fs.writeFileSync('src/pages/Inbox.jsx', code);
console.log('Success');
