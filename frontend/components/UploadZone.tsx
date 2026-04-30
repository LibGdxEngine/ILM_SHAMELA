'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { uploadDocument, UploadResponse, getAuthors, Author, UploadDocumentParams, getCategories, Category, getOCREngines, OCREngine } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';

interface UploadZoneProps {
  onUploadSuccess?: () => void;
}

const INPUT_BASE =
  'w-full px-4 py-3.5 rounded-[12px] text-[15px] font-fraunces outline-none transition-all bg-white/[0.02] text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft focus:shadow-[0_0_0_4px_rgba(192,133,82,0.08)] disabled:opacity-60 disabled:cursor-not-allowed';
const INPUT_BORDER = 'border border-border';
const INPUT_BORDER_ERROR = 'border border-red-500/50';
const LABEL_CLASS = 'block text-[12px] tracking-[0.08em] uppercase text-text-3 mb-2';
const FIELD_ERROR_CLASS = 'mt-2 text-[12.5px] text-red-300';
const FIELD_HINT_CLASS = 'mt-2 text-[12px] text-text-3';
const SECTION_CLASS =
  'bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-7 md:p-9 relative overflow-hidden';
const SECTION_TOP_LINE_CLASS =
  'absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent';
const SECTION_EYEBROW_CLASS =
  'text-[11px] tracking-[0.18em] uppercase text-accent font-medium';
const CHIP_BUTTON_BASE =
  'inline-flex items-center justify-center px-4 py-3 text-[13px] font-medium rounded-[12px] border border-border-strong text-text bg-white/5 transition-all duration-200 hover:bg-white/10 hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed';

export default function UploadZone({ onUploadSuccess }: UploadZoneProps = {}) {
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverPhotoInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [authorInput, setAuthorInput] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [alternateTitles, setAlternateTitles] = useState<string[]>([]);
  const [alternateTitleInput, setAlternateTitleInput] = useState('');
  const [description, setDescription] = useState('');
  const [writtenDate, setWrittenDate] = useState('');
  const [language, setLanguage] = useState('');
  const [coverPhoto, setCoverPhoto] = useState<File | null>(null);
  const [coverPhotoPreview, setCoverPhotoPreview] = useState<string | null>(null);
  const [ocrEngine, setOcrEngine] = useState('auto');
  const [ocrEngines, setOcrEngines] = useState<OCREngine[]>([]);

  // Authors search state
  const [availableAuthors, setAvailableAuthors] = useState<Author[]>([]);
  const [isSearchingAuthors, setIsSearchingAuthors] = useState(false);
  const [showAuthorsDropdown, setShowAuthorsDropdown] = useState(false);
  const authorsDropdownRef = useRef<HTMLDivElement>(null);

  // Categories state
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [showCategoriesDropdown, setShowCategoriesDropdown] = useState(false);
  const categoriesDropdownRef = useRef<HTMLDivElement>(null);

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fetch authors when search query changes
  useEffect(() => {
    const searchAuthors = async () => {
      if (authorInput.trim().length < 2) {
        setAvailableAuthors([]);
        return;
      }

      setIsSearchingAuthors(true);
      try {
        const response = await getAuthors(authorInput);
        // Filter out already selected authors by name
        const filtered = response.results.filter(
          author => !selectedAuthors.includes(author.name)
        );
        setAvailableAuthors(filtered);
        if (filtered.length > 0) {
          setShowAuthorsDropdown(true);
        }
      } catch (error) {
        console.error('Failed to search authors:', error);
        setAvailableAuthors([]);
      } finally {
        setIsSearchingAuthors(false);
      }
    };

    const debounceTimer = setTimeout(searchAuthors, 300);
    return () => clearTimeout(debounceTimer);
  }, [authorInput, selectedAuthors]);

  // Fetch available categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      try {
        const response = await getCategories();
        setAvailableCategories(response.results);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    fetchCategories();
  }, []);

  // Fetch available OCR engines on mount
  useEffect(() => {
    getOCREngines()
      .then(setOcrEngines)
      .catch((error) => {
        console.error('Failed to fetch OCR engines:', error);
        setOcrEngines([]);
      });
  }, []);

  // Close authors dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (authorsDropdownRef.current && !authorsDropdownRef.current.contains(event.target as Node)) {
        setShowAuthorsDropdown(false);
      }
      if (categoriesDropdownRef.current && !categoriesDropdownRef.current.contains(event.target as Node)) {
        setShowCategoriesDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'];
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      setErrors({ file: t('upload.invalidFile', 'يرجى اختيار ملف صالح (PDF أو DOC أو DOCX أو TXT).') });
      return;
    }

    setSelectedFile(file);
    setTitle(file.name.replace(/\.[^/.]+$/, '')); // Remove extension for default title
    setErrors(prev => ({ ...prev, file: '' }));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleCoverPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Validate image type
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, cover_photo: t('upload.invalidImage', 'يرجى اختيار صورة صالحة.') }));
        return;
      }
      setCoverPhoto(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setCoverPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setErrors(prev => ({ ...prev, cover_photo: '' }));
    }
  };

  const handleAddAuthor = () => {
    const trimmed = authorInput.trim();
    if (trimmed && !selectedAuthors.includes(trimmed)) {
      setSelectedAuthors([...selectedAuthors, trimmed]);
      setAuthorInput('');
      setShowAuthorsDropdown(false);
    }
  };

  const handleSelectAuthor = (author: Author) => {
    const authorName = author.name;
    if (!selectedAuthors.includes(authorName)) {
      setSelectedAuthors([...selectedAuthors, authorName]);
      setAuthorInput('');
      setShowAuthorsDropdown(false);
    }
  };

  const handleRemoveAuthor = (authorName: string) => {
    setSelectedAuthors(selectedAuthors.filter(a => a !== authorName));
  };

  const handleAuthorKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAuthor();
    }
  };

  const handleAuthorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAuthorInput(value);
    if (value.trim().length > 0) {
      setShowAuthorsDropdown(true);
    } else {
      setShowAuthorsDropdown(false);
    }
  };

  const filteredAuthors = availableAuthors.filter(
    author => author.name.toLowerCase().includes(authorInput.toLowerCase()) &&
             !selectedAuthors.includes(author.name)
  );

  const handleAddCategory = () => {
    const trimmed = categoryInput.trim();
    if (trimmed && !categories.includes(trimmed)) {
      setCategories([...categories, trimmed]);
      setCategoryInput('');
      setShowCategoriesDropdown(false);
    }
  };

  const handleSelectCategory = (category: Category) => {
    if (!categories.includes(category.name)) {
      setCategories([...categories, category.name]);
      setCategoryInput('');
      setShowCategoriesDropdown(false);
    }
  };

  const handleRemoveCategory = (category: string) => {
    setCategories(categories.filter(c => c !== category));
  };

  const handleCategoryKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCategory();
    }
  };

  const handleCategoryInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCategoryInput(value);
    if (value.trim().length > 0) {
      setShowCategoriesDropdown(true);
    } else {
      setShowCategoriesDropdown(false);
    }
  };

  const filteredCategories = availableCategories.filter(
    cat => cat.name.toLowerCase().includes(categoryInput.toLowerCase()) &&
           !categories.includes(cat.name)
  );

  const handleAddAlternateTitle = () => {
    const trimmed = alternateTitleInput.trim();
    if (trimmed && !alternateTitles.includes(trimmed) && trimmed !== title.trim()) {
      setAlternateTitles([...alternateTitles, trimmed]);
      setAlternateTitleInput('');
    }
  };

  const handleRemoveAlternateTitle = (title: string) => {
    setAlternateTitles(alternateTitles.filter(t => t !== title));
  };

  const handleAlternateTitleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAlternateTitle();
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!selectedFile) {
      newErrors.file = t('upload.fileRequired', 'يرجى اختيار ملف للرفع.');
    }

    if (!title.trim()) {
      newErrors.title = t('upload.titleRequired', 'العنوان مطلوب.');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileUpload = async () => {
    if (!validateForm() || !selectedFile) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('idle');
    setUploadMessage('');

    try {
      const uploadParams: UploadDocumentParams = {
        file: selectedFile,
        title: title.trim(),
        author_names: selectedAuthors.length > 0 ? selectedAuthors : undefined,
        category_names: categories.length > 0 ? categories : undefined,
        alternate_names: alternateTitles.length > 0 ? alternateTitles : undefined,
        description: description.trim() || undefined,
        written_date: writtenDate.trim() || undefined,
        language: language || undefined,
        cover_photo: coverPhoto || undefined,
        ocr_engine: ocrEngine || undefined,
      };

      const response: UploadResponse = await uploadDocument(uploadParams, (progress) => {
        setUploadProgress(progress);
      });

      setUploadStatus('success');
      setUploadMessage(
        t('upload.successMessage', 'تم رفع الملف "{title}" بنجاح.', {
          title: response.title,
        })
      );
      setUploadProgress(100);

      // Call success callback if provided
      if (onUploadSuccess) {
        onUploadSuccess();
      }

      // Reset form after 3 seconds
      setTimeout(() => {
        resetForm();
      }, 3000);
    } catch (error) {
      setUploadStatus('error');
      setUploadMessage(
        error instanceof Error ? error.message : t('upload.uploadFailed', 'تعذر رفع الملف.')
      );
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setTitle('');
    setSelectedAuthors([]);
    setAuthorInput('');
    setCategories([]);
    setCategoryInput('');
    setAlternateTitles([]);
    setAlternateTitleInput('');
    setDescription('');
    setWrittenDate('');
    setLanguage('');
    setCoverPhoto(null);
    setCoverPhotoPreview(null);
    setOcrEngine('auto');
    setUploadStatus('idle');
    setUploadMessage('');
    setUploadProgress(0);
    setErrors({});
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (coverPhotoInputRef.current) {
      coverPhotoInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  const canSubmit = !isUploading && Boolean(selectedFile) && title.trim().length > 0;

  return (
    <div className="w-full space-y-5">
      {/* File drop zone */}
      <section className={SECTION_CLASS}>
        <div className={SECTION_TOP_LINE_CLASS} />

        <div className="mb-6">
          <span className={SECTION_EYEBROW_CLASS}>
            {t('upload.documentFile', 'ملف الكتاب')} <span className="text-red-300">*</span>
          </span>
          <p className="mt-2 text-[14px] text-text-2">
            {t('upload.supportedFiles', 'الملفات المدعومة: PDF وDOC وDOCX وTXT')}
          </p>
        </div>

        <div
          className={`
            relative rounded-[18px] p-10 text-center cursor-pointer transition-all duration-200
            border-2 border-dashed
            ${
              isDragging
                ? 'border-accent bg-accent-soft'
                : errors.file
                ? 'border-red-500/50 bg-red-500/5'
                : 'border-border-strong bg-white/[0.015] hover:border-accent/60 hover:bg-accent-soft/40'
            }
            ${isUploading ? 'pointer-events-none opacity-75' : ''}
          `}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileInputChange}
            disabled={isUploading}
            accept=".pdf,.doc,.docx,.txt"
          />

          <div className="flex flex-col items-center justify-center gap-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-accent-soft text-accent-2 border border-accent/20">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div>
              <p className="font-fraunces text-[19px] text-text">
                {selectedFile
                  ? selectedFile.name
                  : isUploading
                  ? t('upload.uploading', 'جارٍ الرفع...')
                  : t('upload.dragDrop', 'اسحب الملف هنا أو انقر للاختيار')}
              </p>
              {!selectedFile && !isUploading && (
                <p className="text-[13px] text-text-3 mt-2">
                  {t('upload.supportedFiles', 'الملفات المدعومة: PDF وDOC وDOCX وTXT')}
                </p>
              )}
            </div>

            {isUploading && (
              <div className="w-full max-w-md">
                <div className="bg-white/[0.04] rounded-full h-2 overflow-hidden border border-border">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[12px] text-text-3 mt-2 tracking-wide">
                  {Math.round(uploadProgress)}%
                </p>
              </div>
            )}
          </div>
        </div>
        {errors.file && (
          <p className={FIELD_ERROR_CLASS}>{errors.file}</p>
        )}
      </section>

      {/* Basic information */}
      <section className={SECTION_CLASS}>
        <div className={SECTION_TOP_LINE_CLASS} />

        <div className="mb-6">
          <span className={SECTION_EYEBROW_CLASS}>
            {t('upload.basicInfo', 'معلومات أساسية')}
          </span>
          <p className="mt-2 text-[14px] text-text-2">
            {t('upload.basicInfoHint', 'Title, authors, categories, and a short description.')}
          </p>
        </div>

        <div className="space-y-5">
          {/* Title */}
          <div>
            <label htmlFor="title" className={LABEL_CLASS}>
              {t('upload.title', 'العنوان')} <span className="text-red-300 normal-case">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrors(prev => ({ ...prev, title: '' }));
              }}
              className={`${INPUT_BASE} ${errors.title ? INPUT_BORDER_ERROR : INPUT_BORDER}`}
              placeholder={t('upload.enterTitle', 'اكتب عنوان الكتاب')}
              disabled={isUploading}
            />
            {errors.title && (
              <p className={FIELD_ERROR_CLASS}>{errors.title}</p>
            )}
          </div>

          {/* Authors */}
          <div>
            <label className={LABEL_CLASS}>
              {t('upload.authors', 'المؤلفون')}
            </label>
            <div className="relative" ref={authorsDropdownRef}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={authorInput}
                  onChange={handleAuthorInputChange}
                  onKeyPress={handleAuthorKeyPress}
                  onFocus={() => {
                    if (filteredAuthors.length > 0) {
                      setShowAuthorsDropdown(true);
                    }
                  }}
                  className={`${INPUT_BASE} ${INPUT_BORDER} flex-1`}
                  placeholder={t('upload.searchOrAuthor', 'ابحث أو اكتب اسم المؤلف')}
                  disabled={isUploading}
                />
                <button
                  type="button"
                  onClick={handleAddAuthor}
                  className={CHIP_BUTTON_BASE}
                  disabled={isUploading || !authorInput.trim()}
                >
                  {t('upload.add', 'إضافة')}
                </button>
              </div>
              {isSearchingAuthors && (
                <div className="absolute top-3.5 inset-inline-end-3 pointer-events-none">
                  <Spinner />
                </div>
              )}
              {showAuthorsDropdown && filteredAuthors.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-card-2 border border-border-strong rounded-[12px] shadow-[0_12px_30px_-8px_rgba(0,0,0,0.55)] max-h-60 overflow-auto">
                  {filteredAuthors.map((author) => (
                    <div
                      key={author.id}
                      onClick={() => handleSelectAuthor(author)}
                      className="px-4 py-2.5 text-[14px] text-text hover:bg-accent-soft hover:text-accent-2 cursor-pointer transition-colors"
                    >
                      {author.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedAuthors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedAuthors.map((authorName) => (
                  <span
                    key={authorName}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-[12.5px] bg-accent-soft border border-accent/30 text-accent-2"
                  >
                    {authorName}
                    <button
                      type="button"
                      onClick={() => handleRemoveAuthor(authorName)}
                      className={`${isRtl ? 'mr-2' : 'ml-2'} text-accent-2 hover:text-text transition-colors`}
                      disabled={isUploading}
                      aria-label={t('upload.remove', 'Remove')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className={FIELD_HINT_CLASS}>
              {t('upload.authorHint', 'اختر من المؤلفين المتاحين أو أضف مؤلفًا جديدًا.')}
            </p>
          </div>

          {/* Categories */}
          <div>
            <label className={LABEL_CLASS}>
              {t('upload.categories', 'التصنيفات')}
            </label>
            <div className="relative" ref={categoriesDropdownRef}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={categoryInput}
                  onChange={handleCategoryInputChange}
                  onKeyPress={handleCategoryKeyPress}
                  onFocus={() => {
                    if (filteredCategories.length > 0) {
                      setShowCategoriesDropdown(true);
                    }
                  }}
                  className={`${INPUT_BASE} ${INPUT_BORDER} flex-1`}
                  placeholder={t('upload.searchOrCategory', 'ابحث أو اكتب اسم التصنيف')}
                  disabled={isUploading}
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className={CHIP_BUTTON_BASE}
                  disabled={isUploading || !categoryInput.trim()}
                >
                  {t('upload.add', 'إضافة')}
                </button>
              </div>
              {isLoadingCategories && (
                <div className="absolute top-3.5 inset-inline-end-3 pointer-events-none">
                  <Spinner />
                </div>
              )}
              {showCategoriesDropdown && filteredCategories.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-card-2 border border-border-strong rounded-[12px] shadow-[0_12px_30px_-8px_rgba(0,0,0,0.55)] max-h-60 overflow-auto">
                  {filteredCategories.map((category) => (
                    <div
                      key={category.id}
                      onClick={() => handleSelectCategory(category)}
                      className="px-4 py-2.5 text-[14px] text-text hover:bg-accent-soft hover:text-accent-2 cursor-pointer transition-colors"
                    >
                      {category.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {categories.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {categories.map((category) => (
                  <span
                    key={category}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-[12.5px] bg-white/5 border border-border-strong text-text-2"
                  >
                    {category}
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(category)}
                      className={`${isRtl ? 'mr-2' : 'ml-2'} text-text-3 hover:text-text transition-colors`}
                      disabled={isUploading}
                      aria-label={t('upload.remove', 'Remove')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className={FIELD_HINT_CLASS}>
              {t('upload.categoryHint', 'اختر من التصنيفات المتاحة أو أضف تصنيفًا جديدًا.')}
            </p>
          </div>

          {/* Alternate Titles */}
          <div>
            <label className={LABEL_CLASS}>
              {t('upload.altTitles', 'العناوين البديلة')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={alternateTitleInput}
                onChange={(e) => setAlternateTitleInput(e.target.value)}
                onKeyPress={handleAlternateTitleKeyPress}
                className={`${INPUT_BASE} ${INPUT_BORDER} flex-1`}
                placeholder={t('upload.altInput', 'اكتب عنوانًا بديلًا ثم اضغط Enter')}
                disabled={isUploading}
              />
              <button
                type="button"
                onClick={handleAddAlternateTitle}
                className={CHIP_BUTTON_BASE}
                disabled={isUploading || !alternateTitleInput.trim() || alternateTitleInput.trim() === title.trim()}
              >
                {t('upload.add', 'إضافة')}
              </button>
            </div>
            {alternateTitles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {alternateTitles.map((altTitle) => (
                  <span
                    key={altTitle}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-[12.5px] bg-white/5 border border-border-strong text-text-2"
                  >
                    {altTitle}
                    <button
                      type="button"
                      onClick={() => handleRemoveAlternateTitle(altTitle)}
                      className={`${isRtl ? 'mr-2' : 'ml-2'} text-text-3 hover:text-text transition-colors`}
                      disabled={isUploading}
                      aria-label={t('upload.remove', 'Remove')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className={FIELD_HINT_CLASS}>
              {t('upload.altHint', 'أضف أسماء بديلة مختلفة عن العنوان الرئيسي.')}
            </p>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className={LABEL_CLASS}>
              {t('upload.description', 'الوصف')}
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={`${INPUT_BASE} ${INPUT_BORDER} resize-none`}
              placeholder={t('upload.descriptionInput', 'اكتب وصف الكتاب...')}
              disabled={isUploading}
            />
          </div>
        </div>
      </section>

      {/* Advanced options */}
      <section className={SECTION_CLASS}>
        <div className={SECTION_TOP_LINE_CLASS} />

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div>
            <span className={SECTION_EYEBROW_CLASS}>
              {t('upload.advanced', 'خيارات متقدمة')}
            </span>
            <p className="mt-2 text-[14px] text-text-2">
              {t('upload.advancedHint', 'Date, language, OCR engine, and cover.')}
            </p>
          </div>
          <span
            className={`flex-shrink-0 w-9 h-9 rounded-full border border-border-strong text-text-2 flex items-center justify-center transition-transform duration-200 ${
              showAdvanced ? 'rotate-180' : ''
            }`}
            aria-hidden
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>

        {showAdvanced && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mt-7 pt-7 border-t border-border space-y-5"
          >
            {/* Written Date */}
            <div>
              <label htmlFor="written_date" className={LABEL_CLASS}>
                {t('upload.writtenDate', 'تاريخ التأليف')}
              </label>
              <input
                type="text"
                id="written_date"
                value={writtenDate}
                onChange={(e) => setWrittenDate(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_BORDER}`}
                placeholder={t('upload.writtenDatePlaceholder', '1200م أو القرن الخامس')}
                disabled={isUploading}
              />
              <p className={FIELD_HINT_CLASS}>
                {t('upload.writtenDateHint', 'صيغة مرنة مثل: 1200م أو القرن الخامس.')}
              </p>
            </div>

            {/* Language */}
            <div>
              <label htmlFor="language" className={LABEL_CLASS}>
                {t('upload.language', 'لغة المحتوى')}
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_BORDER} cursor-pointer`}
                disabled={isUploading}
              >
                <option value="">{t('upload.selectLanguage', 'اختر اللغة')}</option>
                <option value="ar">{t('upload.languageName.ar', 'العربية')}</option>
                <option value="en">{t('upload.languageName.en', 'English')}</option>
                <option value="fa">{t('upload.languageName.fa', 'فارسی')}</option>
                <option value="ur">{t('upload.languageName.ur', 'اردو')}</option>
                <option value="fr">{t('upload.languageName.fr', 'Français')}</option>
                <option value="es">{t('upload.languageName.es', 'Español')}</option>
                <option value="de">{t('upload.languageName.de', 'Deutsch')}</option>
                <option value="it">{t('upload.languageName.it', 'Italiano')}</option>
                <option value="pt">{t('upload.languageName.pt', 'Português')}</option>
                <option value="ru">{t('upload.languageName.ru', 'Русский')}</option>
                <option value="zh">{t('upload.languageName.zh', '中文')}</option>
                <option value="ja">{t('upload.languageName.ja', '日本語')}</option>
                <option value="tr">{t('upload.languageName.tr', 'Türkçe')}</option>
              </select>
            </div>

            {/* OCR Engine */}
            <div>
              <label htmlFor="ocr_engine" className={LABEL_CLASS}>
                {t('upload.ocrEngine', 'محرك التعرف الضوئي (OCR)')}
              </label>
              <select
                id="ocr_engine"
                value={ocrEngine}
                onChange={(e) => setOcrEngine(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_BORDER} cursor-pointer`}
                disabled={isUploading}
              >
                {ocrEngines.length === 0 ? (
                  <option value="auto">
                    {t('upload.ocrEngineOption.auto', 'تلقائي (موصى به)')}
                  </option>
                ) : (
                  ocrEngines.map((engine) => (
                    <option
                      key={engine.id}
                      value={engine.id}
                      disabled={!engine.available}
                    >
                      {t(`upload.ocrEngineOption.${engine.id}`, engine.label)}
                      {!engine.available ? ` — ${t('upload.ocrEngineUnavailable', 'غير متاح')}` : ''}
                    </option>
                  ))
                )}
              </select>
              <p className={FIELD_HINT_CLASS}>
                {t('upload.ocrEngineHint', "اختر كيفية معالجة ملفات PDF الممسوحة ضوئيًا. خيار \"تلقائي\" يشغّل OCR عند الحاجة فقط.")}
              </p>
            </div>

            {/* Cover Photo */}
            <div>
              <label className={LABEL_CLASS}>
                {t('upload.cover', 'صورة الغلاف')}
              </label>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => coverPhotoInputRef.current?.click()}
                  disabled={isUploading}
                  className={`${CHIP_BUTTON_BASE} self-start`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className={isRtl ? 'ml-2' : 'mr-2'}
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  {coverPhoto
                    ? t('upload.changeCover', 'Change cover')
                    : t('upload.chooseCover', 'Choose image')}
                </button>
                <input
                  ref={coverPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverPhotoSelect}
                  className="hidden"
                  disabled={isUploading}
                />
                {errors.cover_photo && (
                  <p className={FIELD_ERROR_CLASS}>{errors.cover_photo}</p>
                )}
                {coverPhotoPreview && (
                  <div className="relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverPhotoPreview}
                      alt={t('upload.cover', 'صورة الغلاف')}
                      className="max-w-xs h-48 object-cover rounded-[12px] border border-border-strong"
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </section>

      {/* Status Messages */}
      {uploadStatus === 'success' && (
        <div
          role="status"
          className="rounded-[12px] px-4 py-3 text-[13px] bg-accent-soft border border-accent/40 text-accent-2"
        >
          {uploadMessage}
        </div>
      )}

      {uploadStatus === 'error' && (
        <div
          role="alert"
          className="rounded-[12px] px-4 py-3 text-[13px] bg-red-500/10 border border-red-500/40 text-red-200"
        >
          {uploadMessage}
        </div>
      )}

      {/* Submit row */}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={resetForm}
          className={CHIP_BUTTON_BASE}
          disabled={isUploading}
        >
          {t('upload.reset', 'إعادة ضبط')}
        </button>
        <motion.button
          type="button"
          onClick={handleFileUpload}
          disabled={!canSubmit}
          whileHover={canSubmit ? { y: -1 } : undefined}
          whileTap={canSubmit ? { y: 0, scale: 0.99 } : undefined}
          transition={{ duration: 0.15 }}
          className="btn-primary !rounded-[14px] !px-7 !py-3.5 !text-[14.5px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <>
              <Spinner />
              {t('upload.uploading', 'جارٍ الرفع...')}
            </>
          ) : (
            <>
              {t('upload.submit', 'رفع الكتاب')}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <motion.svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </motion.svg>
  );
}
