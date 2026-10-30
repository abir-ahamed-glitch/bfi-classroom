import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import { pdfjs as reactPdfjs } from 'react-pdf';
import PdfViewer from './components/PdfViewer.jsx';
import BulkRegisteredStudentImport from './components/admin/BulkRegisteredStudentImport.jsx';
import BulkStudentImport from './components/admin/BulkStudentImport.jsx';
import UploadResultsModal from './components/admin/UploadResultsModal.jsx';

window.__pdfjsLib = pdfjsLib;
window.__reactPdfjs = reactPdfjs;

function MountHarness() {
  const [componentState, setComponentState] = useState({
    name: null,
    props: {}
  });

  useEffect(() => {
    window.__mountComponent = (name, props = {}) => {
      setComponentState({ name, props });
    };
    window.__unmountComponent = () => {
      setComponentState({ name: null, props: {} });
    };
    window.__harnessReady = true;
  }, []);

  const { name, props } = componentState;

  return (
    <div id="harness-root">
      <div id="harness-status" data-component={name || 'none'}>
        Active Component: <span id="active-component-name">{name || 'None'}</span>
      </div>

      <div id="component-slot">
        {name === 'PdfViewer' && (
          <PdfViewer {...props} />
        )}
        {name === 'BulkRegisteredStudentImport' && (
          <BulkRegisteredStudentImport onImportComplete={() => {}} {...props} />
        )}
        {name === 'BulkStudentImport' && (
          <BulkStudentImport onImportComplete={() => {}} {...props} />
        )}
        {name === 'UploadResultsModal' && (
          <UploadResultsModal isOpen={true} batchId={10} onClose={() => {}} onUploadSuccess={() => {}} {...props} />
        )}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('test-root'));
root.render(<MountHarness />);

export default MountHarness;
