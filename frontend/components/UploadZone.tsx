'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadDocument, UploadResponse, getAuthors, Author, UploadDocumentParams, getCategories, Category } from '@/lib/api';

interface UploadZoneProps {
  onUploadSuccess?: () => void;
}

export default function UploadZone({ onUploadSuccess }: UploadZoneProps = {}) {
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
  const [selectedAuthors, setSelectedAuthors] = useState<Author[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [alternateTitles, setAlternateTitles] = useState<string[]>([]);
  const [alternateTitleInput, setAlternateTitleInput] = useState('');
  const [description, setDescription] = useState('');
  const [writtenDate, setWrittenDate] = useState('');
  const [language, setLanguage] = useState('');
  const [coverPhoto, setCoverPhoto] = useState<File | null>(null);
  const [coverPhotoPreview, setCoverPhotoPreview] = useState<string | null>(null);

  // Authors search state
  const [authorsSearchQuery, setAuthorsSearchQuery] = useState('');
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
      if (authorsSearchQuery.trim().length < 2) {
        setAvailableAuthors([]);
        return;
      }

      setIsSearchingAuthors(true);
      try {
        const response = await getAuthors(authorsSearchQuery);
        // Filter out already selected authors
        const filtered = response.results.filter(
          author => !selectedAuthors.some(selected => selected.id === author.id)
        );
        setAvailableAuthors(filtered);
        setShowAuthorsDropdown(true);
      } catch (error) {
        console.error('Failed to search authors:', error);
        setAvailableAuthors([]);
      } finally {
        setIsSearchingAuthors(false);
      }
    };

    const debounceTimer = setTimeout(searchAuthors, 300);
    return () => clearTimeout(debounceTimer);
  }, [authorsSearchQuery, selectedAuthors]);

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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, []);

  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
      'text/plain'];
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      setErrors({ file: 'Please select a valid file (PDF, DOC, DOCX, or TXT)' });
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
        setErrors(prev => ({ ...prev, cover_photo: 'Please select a valid image file' }));
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

  const handleAddAuthor = (author: Author) => {
    if (!selectedAuthors.some(a => a.id === author.id)) {
      setSelectedAuthors([...selectedAuthors, author]);
      setAuthorsSearchQuery('');
      setShowAuthorsDropdown(false);
    }
  };

  const handleRemoveAuthor = (authorId: number) => {
    setSelectedAuthors(selectedAuthors.filter(a => a.id !== authorId));
  };

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
      newErrors.file = 'Please select a file to upload';
    }

    if (!title.trim()) {
      newErrors.title = 'Title is required';
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
        authors_ids: selectedAuthors.map(a => a.id),
        category_names: categories.length > 0 ? categories : undefined,
        alternate_names: alternateTitles.length > 0 ? alternateTitles : undefined,
        description: description.trim() || undefined,
        written_date: writtenDate.trim() || undefined,
        language: language || undefined,
        cover_photo: coverPhoto || undefined,
      };

      const response: UploadResponse = await uploadDocument(uploadParams, (progress) => {
        setUploadProgress(progress);
      });

      setUploadStatus('success');
      setUploadMessage(`File "${response.title}" uploaded successfully!`);
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
        error instanceof Error ? error.message : 'Failed to upload file'
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
    setCategories([]);
    setCategoryInput('');
    setAlternateTitles([]);
    setAlternateTitleInput('');
    setDescription('');
    setWrittenDate('');
    setLanguage('');
    setCoverPhoto(null);
    setCoverPhotoPreview(null);
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

  return (
    <div className="w-full space-y-6">
      {/* File Upload Zone */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Document File <span className="text-red-500">*</span>
        </label>
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-all duration-200
            ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : errors.file
                ? 'border-red-300 bg-red-50'
                : 'border-gray-300 hover:border-gray-400'
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

          <div className="flex flex-col items-center justify-center space-y-4">
            <svg
              className="w-12 h-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>

            <div>
              <p className="text-lg font-medium text-gray-700">
                {selectedFile
                  ? selectedFile.name
                  : isUploading
                  ? 'Uploading...'
                  : 'Drag and drop a file here, or click to select'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                PDF, DOC, DOCX, TXT files are supported
              </p>
            </div>

            {isUploading && (
              <div className="w-full max-w-md">
                <div className="bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  {Math.round(uploadProgress)}%
                </p>
              </div>
            )}
          </div>
        </div>
        {errors.file && (
          <p className="mt-1 text-sm text-red-600">{errors.file}</p>
        )}
      </div>

      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
        
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors(prev => ({ ...prev, title: '' }));
            }}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.title ? 'border-red-300' : 'border-gray-300'
            }`}
            placeholder="Enter document title"
            disabled={isUploading}
          />
          {errors.title && (
            <p className="mt-1 text-sm text-red-600">{errors.title}</p>
          )}
        </div>

        {/* Authors */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Authors
          </label>
          <div className="relative" ref={authorsDropdownRef}>
            <input
              type="text"
              value={authorsSearchQuery}
              onChange={(e) => setAuthorsSearchQuery(e.target.value)}
              onFocus={() => {
                if (availableAuthors.length > 0) {
                  setShowAuthorsDropdown(true);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search for authors..."
              disabled={isUploading}
            />
            {isSearchingAuthors && (
              <div className="absolute right-3 top-2.5">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            )}
            {showAuthorsDropdown && availableAuthors.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                {availableAuthors.map((author) => (
                  <div
                    key={author.id}
                    onClick={() => handleAddAuthor(author)}
                    className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
                  >
                    {author.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedAuthors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedAuthors.map((author) => (
                <span
                  key={author.id}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
                >
                  {author.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveAuthor(author.id)}
                    className="ml-2 text-blue-600 hover:text-blue-800"
                    disabled={isUploading}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Categories */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Categories
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search or enter category name"
                disabled={isUploading}
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
                disabled={isUploading || !categoryInput.trim()}
              >
                Add
              </button>
            </div>
            {isLoadingCategories && (
              <div className="absolute right-3 top-2.5">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            )}
            {showCategoriesDropdown && filteredCategories.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                {filteredCategories.map((category) => (
                  <div
                    key={category.id}
                    onClick={() => handleSelectCategory(category)}
                    className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
                  >
                    {category.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          {categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((category) => (
                <span
                  key={category}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800"
                >
                  {category}
                  <button
                    type="button"
                    onClick={() => handleRemoveCategory(category)}
                    className="ml-2 text-gray-600 hover:text-gray-800"
                    disabled={isUploading}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Select from existing categories or type a new category name
          </p>
        </div>

        {/* Alternate Titles */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Alternate Titles
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={alternateTitleInput}
              onChange={(e) => setAlternateTitleInput(e.target.value)}
              onKeyPress={handleAlternateTitleKeyPress}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter alternate title and press Enter"
              disabled={isUploading}
            />
            <button
              type="button"
              onClick={handleAddAlternateTitle}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
              disabled={isUploading || !alternateTitleInput.trim() || alternateTitleInput.trim() === title.trim()}
            >
              Add
            </button>
          </div>
          {alternateTitles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {alternateTitles.map((altTitle) => (
                <span
                  key={altTitle}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-purple-100 text-purple-800"
                >
                  {altTitle}
                  <button
                    type="button"
                    onClick={() => handleRemoveAlternateTitle(altTitle)}
                    className="ml-2 text-purple-600 hover:text-purple-800"
                    disabled={isUploading}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Add alternative names or titles for this document (different from the main title)
          </p>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter document description..."
            disabled={isUploading}
          />
        </div>
      </div>

      {/* Advanced Options */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          <span className="ml-2">Advanced Options</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4 pl-6 border-l-2 border-gray-200">
            {/* Written Date */}
            <div>
              <label htmlFor="written_date" className="block text-sm font-medium text-gray-700 mb-1">
                Written Date
              </label>
              <input
                type="text"
                id="written_date"
                value={writtenDate}
                onChange={(e) => setWrittenDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 1200 CE, 5th century"
                disabled={isUploading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Flexible format (e.g., "1200 CE", "5th century")
              </p>
            </div>

            {/* Language */}
            <div>
              <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-1">
                Language
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isUploading}
              >
                <option value="">Select language</option>
                <option value="ar">Arabic</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="ru">Russian</option>
                <option value="zh">Chinese</option>
                <option value="ja">Japanese</option>
              </select>
            </div>

            {/* Cover Photo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cover Photo
              </label>
              <input
                ref={coverPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverPhotoSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                disabled={isUploading}
              />
              {errors.cover_photo && (
                <p className="mt-1 text-sm text-red-600">{errors.cover_photo}</p>
              )}
              {coverPhotoPreview && (
                <div className="mt-2">
                  <img
                    src={coverPhotoPreview}
                    alt="Cover preview"
                    className="max-w-xs h-48 object-cover rounded-md border border-gray-300"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status Messages */}
      {uploadStatus === 'success' && (
        <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg">
          <p className="font-medium">{uploadMessage}</p>
        </div>
      )}

      {uploadStatus === 'error' && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <p className="font-medium">{uploadMessage}</p>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={resetForm}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          disabled={isUploading}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleFileUpload}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isUploading || !selectedFile || !title.trim()}
        >
          {isUploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>
    </div>
  );
}
