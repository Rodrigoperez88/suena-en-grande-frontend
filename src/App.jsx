import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@clerk/clerk-react";
import "./App.css";

const ORDER_STATUSES = [
  { value: "pendiente", label: "Pendiente" },
  { value: "confirmado", label: "Confirmado" },
  { value: "en_preparacion", label: "En preparacion" },
  { value: "enviado", label: "Enviado" },
  { value: "entregado", label: "Entregado" },
  { value: "cancelado", label: "Cancelado" },
];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const OUTPUT_IMAGE_QUALITY = 0.88;

const EMPTY_PRODUCT_FORM = {
  id: null,
  name: "",
  description: "",
  price: "",
  stock: "",
  category: "",
  image: "",
};

const createEmptyProductForm = () => ({
  ...EMPTY_PRODUCT_FORM,
});

const EMPTY_CATEGORY_FORM = {
  id: null,
  name: "",
  image: "",
};

const createEmptyCategoryForm = () => ({
  ...EMPTY_CATEGORY_FORM,
});

export default function App() {
  const { getToken, isSignedIn, isLoaded: isAuthLoaded } = useAuth();
  const { user } = useUser();
  const apiUrl = import.meta.env.VITE_API_URL;
  const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const cloudinaryUploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const adminEmails = (import.meta.env.VITE_CLERK_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const [activeView, setActiveView] = useState("shop");
  const [apiMessage, setApiMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);

  const [checkout, setCheckout] = useState({
    customerName: "",
    customerPhone: "",
    address: "",
    deliveryMethod: "retiro",
    notes: "",
  });
  const [checkoutErrors, setCheckoutErrors] = useState({});
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const [lastOrderId, setLastOrderId] = useState(null);

  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [productForm, setProductForm] = useState(createEmptyProductForm);
  const [categoryForm, setCategoryForm] = useState(createEmptyCategoryForm);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingCategoryImage, setUploadingCategoryImage] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState(null);
  const [deletingProductId, setDeletingProductId] = useState(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState("todos");
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("todos");
  const [adminProductSearch, setAdminProductSearch] = useState("");
  const [adminProductCategoryFilter, setAdminProductCategoryFilter] = useState("todas");

  const currencyFormatter = useMemo(() => {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    });
  }, []);
  const currentUserEmails = user?.emailAddresses.map((email) => email.emailAddress.toLowerCase()) || [];
  const isAdminUser =
    isSignedIn &&
    adminEmails.length > 0 &&
    currentUserEmails.some((email) => adminEmails.includes(email));
  const adminMetrics = useMemo(() => {
    const pendingOrders = orders.filter((order) => order.status === "pendiente").length;
    const deliveredOrders = orders.filter((order) => order.status === "entregado").length;
    const totalSales = orders
      .filter((order) => order.status !== "cancelado")
      .reduce((acc, order) => acc + Number(order.total || 0), 0);
    const lowStockProducts = products.filter((product) => Number(product.stock || 0) <= 3).length;

    return {
      pendingOrders,
      deliveredOrders,
      totalSales,
      lowStockProducts,
    };
  }, [orders, products]);
  const filteredOrders = useMemo(() => {
    const normalizedSearch = orderSearch.trim().toLowerCase();

    return orders
      .filter((order) => {
        const matchesStatus = orderStatusFilter === "todos" || order.status === orderStatusFilter;
        const searchableText = [
          order.id,
          order.customerName,
          order.customerPhone,
          order.deliveryMethod,
          order.address,
          order.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);

        return matchesStatus && matchesSearch;
      })
      .sort((firstOrder, secondOrder) => {
        if (firstOrder.status === "pendiente" && secondOrder.status !== "pendiente") {
          return -1;
        }

        if (firstOrder.status !== "pendiente" && secondOrder.status === "pendiente") {
          return 1;
        }

        return new Date(secondOrder.createdAt) - new Date(firstOrder.createdAt);
      });
  }, [orderSearch, orderStatusFilter, orders]);
  const filteredAdminProducts = useMemo(() => {
    const normalizedSearch = adminProductSearch.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory =
        adminProductCategoryFilter === "todas" ||
        (product.category || "Sin categoria") === adminProductCategoryFilter;
      const searchableText = [
        product.name,
        product.description,
        product.category,
        product.price,
        product.stock,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [adminProductCategoryFilter, adminProductSearch, products]);

  const getAdminRequestConfig = useCallback(async () => {
    const token = await getToken();

    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }, [getToken]);

  useEffect(() => {
    const loadStore = async () => {
      try {
        setLoading(true);
        setError("");

        const [healthResponse, productsResponse, categoriesResponse] = await Promise.all([
          axios.get(`${apiUrl}/`),
          axios.get(`${apiUrl}/productos`),
          axios.get(`${apiUrl}/categorias`),
        ]);

        setApiMessage(healthResponse.data.message || "");
        setProducts(Array.isArray(productsResponse.data) ? productsResponse.data : []);
        setCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);
      } catch (err) {
        console.error("Error al cargar tienda:", err);
        setError("No se pudo conectar con el backend.");
      } finally {
        setLoading(false);
      }
    };

    loadStore();
  }, [apiUrl]);

  const loadProducts = async () => {
    const response = await axios.get(`${apiUrl}/productos`);
    setProducts(Array.isArray(response.data) ? response.data : []);
  };

  const loadCategories = async () => {
    const response = await axios.get(`${apiUrl}/categorias`);
    setCategories(Array.isArray(response.data) ? response.data : []);
  };

  const loadAdminData = async () => {
    try {
      setAdminLoading(true);
      setAdminError("");
      const adminConfig = await getAdminRequestConfig();

      const [productsResponse, ordersResponse, categoriesResponse] = await Promise.all([
        axios.get(`${apiUrl}/admin/productos`, adminConfig),
        axios.get(`${apiUrl}/admin/pedidos`, adminConfig),
        axios.get(`${apiUrl}/admin/categorias`, adminConfig),
      ]);

      setProducts(Array.isArray(productsResponse.data) ? productsResponse.data : []);
      setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
      setCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);
    } catch (err) {
      console.error("Error al cargar panel admin:", err);
      setAdminError("No se pudieron cargar los datos del panel interno.");
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (activeView !== "admin") {
      return;
    }

    const loadInitialAdminView = async () => {
      if (!isAuthLoaded || !isAdminUser) {
        return;
      }

      try {
        setAdminLoading(true);
        setAdminError("");
        const adminConfig = await getAdminRequestConfig();

        const [productsResponse, ordersResponse, categoriesResponse] = await Promise.all([
          axios.get(`${apiUrl}/admin/productos`, adminConfig),
          axios.get(`${apiUrl}/admin/pedidos`, adminConfig),
          axios.get(`${apiUrl}/admin/categorias`, adminConfig),
        ]);

        setProducts(Array.isArray(productsResponse.data) ? productsResponse.data : []);
        setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
        setCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);
      } catch (err) {
        console.error("Error al cargar panel admin:", err);
        setAdminError("No se pudieron cargar los datos del panel interno.");
      } finally {
        setAdminLoading(false);
      }
    };

    void loadInitialAdminView();
  }, [activeView, apiUrl, getAdminRequestConfig, isAdminUser, isAuthLoaded]);

  const cartTotalQuantity = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const cartTotalAmount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  }, [cart]);

  const formatPrice = (value) => currencyFormatter.format(value || 0);

  const scrollToSection = (sectionId) => {
    setActiveView("shop");
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const formatOrderDate = (dateValue) => {
    if (!dateValue) {
      return "Fecha no disponible";
    }

    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(dateValue));
  };

  const buildOrderSummary = (order) => {
    const itemsText = order.items
      .map((item) => `- ${item.productName} x ${item.quantity}: ${formatPrice(item.subtotal)}`)
      .join("\n");

    return [
      `Pedido #${order.id} - Suena en Grande`,
      `Cliente: ${order.customerName}`,
      `Telefono: ${order.customerPhone}`,
      `Entrega: ${order.deliveryMethod}`,
      `Direccion: ${order.address || "Retira en punto acordado"}`,
      `Estado: ${order.status}`,
      "",
      "Productos:",
      itemsText,
      "",
      `Total: ${formatPrice(order.total)}`,
      `Notas: ${order.notes || "Sin notas"}`,
    ].join("\n");
  };

  const copyTextToClipboard = async (text, fallbackMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("No se pudo copiar el texto:", error);
      window.prompt(fallbackMessage, text);
      return false;
    }
  };

  const getWhatsAppPhone = (phoneValue) => {
    const digits = String(phoneValue || "").replace(/\D/g, "");

    if (digits.length < 8) {
      return "";
    }

    if (digits.startsWith("549")) {
      return digits;
    }

    if (digits.startsWith("54")) {
      return `549${digits.slice(2)}`;
    }

    if (digits.startsWith("15") && digits.length >= 10) {
      return `549${digits.slice(2)}`;
    }

    return `549${digits}`;
  };

  const sendOrderToWhatsApp = async (order) => {
    const summary = buildOrderSummary(order);
    const whatsappPhone = getWhatsAppPhone(order.customerPhone);

    if (whatsappPhone) {
      window.open(
        `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(summary)}`,
        "_blank",
        "noopener,noreferrer"
      );
      setAdminMessage(`Pedido #${order.id} abierto en WhatsApp.`);
      return;
    }

    const copied = await copyTextToClipboard(summary, "Copia el pedido para WhatsApp:");
    setAdminMessage(
      copied
        ? `Pedido #${order.id} copiado. El telefono no parece valido para abrir WhatsApp.`
        : `Revisa el telefono del pedido #${order.id} antes de enviarlo por WhatsApp.`
    );
  };

  const resetCheckout = () => {
    setCheckout({
      customerName: "",
      customerPhone: "",
      address: "",
      deliveryMethod: "retiro",
      notes: "",
    });
    setCheckoutErrors({});
  };

  const getAvailableStock = (productId) => {
    const product = products.find((item) => item.id === productId);
    return product?.stock ?? 0;
  };

  const addToCart = (product) => {
    const availableStock = getAvailableStock(product.id);
    const cartItem = cart.find((item) => item.id === product.id);
    const nextQuantity = (cartItem?.quantity || 0) + 1;

    if (availableStock <= 0 || nextQuantity > availableStock) {
      setOrderError("No hay stock suficiente para sumar mas unidades.");
      return;
    }

    setOrderError("");
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);

      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const increaseQuantity = (productId) => {
    const availableStock = getAvailableStock(productId);
    const cartItem = cart.find((item) => item.id === productId);

    if (!cartItem || cartItem.quantity >= availableStock) {
      setOrderError("Llegaste al limite de stock disponible para ese producto.");
      return;
    }

    setOrderError("");
    setCart((prev) =>
      prev.map((item) =>
        item.id === productId ? { ...item, quantity: item.quantity + 1 } : item
      )
    );
  };

  const decreaseQuantity = (productId) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((item) => item.id !== productId));
  };

  const updateCheckoutField = (field, value) => {
    setCheckout((prev) => ({ ...prev, [field]: value }));
    setCheckoutErrors((prev) => ({ ...prev, [field]: "" }));
    setOrderError("");
    setOrderMessage("");
    setLastOrderId(null);
  };

  const validateCheckout = () => {
    const nextErrors = {};

    if (!checkout.customerName.trim()) {
      nextErrors.customerName = "Ingresa tu nombre.";
    }

    const phoneDigits = checkout.customerPhone.replace(/\D/g, "");
    if (phoneDigits.length < 8) {
      nextErrors.customerPhone = "Ingresa un telefono valido.";
    }

    if (checkout.deliveryMethod === "envio" && !checkout.address.trim()) {
      nextErrors.address = "La direccion es obligatoria para envios.";
    }

    if (cart.length === 0) {
      nextErrors.cart = "Agrega al menos un producto al carrito.";
    }

    setCheckoutErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitOrder = async () => {
    try {
      setOrderError("");
      setOrderMessage("");

      if (!validateCheckout()) {
        return;
      }

      setSubmittingOrder(true);

      const payload = {
        customerName: checkout.customerName.trim(),
        customerPhone: checkout.customerPhone.trim(),
        address: checkout.address.trim(),
        deliveryMethod: checkout.deliveryMethod,
        notes: checkout.notes.trim(),
        items: cart.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
      };

      const response = await axios.post(`${apiUrl}/pedidos`, payload);

      setLastOrderId(response.data.orderId);
      setOrderMessage(`Pedido enviado con exito. Numero: #${response.data.orderId}`);
      setCart([]);
      resetCheckout();
      await loadProducts();

      if (activeView === "admin") {
        await loadAdminData();
      }
    } catch (err) {
      console.error("Error al enviar pedido:", err);
      const details = err?.response?.data?.details;
      setOrderError(
        Array.isArray(details) && details.length > 0
          ? details.join(" ")
          : err?.response?.data?.error ||
              err?.response?.data?.detalle ||
              "No se pudo enviar el pedido."
      );
    } finally {
      setSubmittingOrder(false);
    }
  };

  const startEditingProduct = (product) => {
    setProductForm({
      id: product.id,
      name: product.name || "",
      description: product.description || "",
      price: String(product.price ?? ""),
      stock: String(product.stock ?? ""),
      category: product.category || "",
      image: product.image || "",
    });
    setAdminMessage("");
    setAdminError("");
  };

  const resetProductForm = () => {
    setProductForm(createEmptyProductForm());
  };

  const startEditingCategory = (category) => {
    setCategoryForm({
      id: category.id,
      name: category.name || "",
      image: category.image || "",
    });
    setAdminMessage("");
    setAdminError("");
  };

  const resetCategoryForm = () => {
    setCategoryForm(createEmptyCategoryForm());
  };

  const saveCategory = async () => {
    try {
      setSavingCategory(true);
      setAdminError("");
      setAdminMessage("");

      const payload = {
        name: categoryForm.name,
        image: categoryForm.image,
      };

      if (categoryForm.id) {
        await axios.patch(
          `${apiUrl}/admin/categorias/${categoryForm.id}`,
          payload,
          await getAdminRequestConfig()
        );
        setAdminMessage("Categoria actualizada correctamente.");
      } else {
        await axios.post(`${apiUrl}/admin/categorias`, payload, await getAdminRequestConfig());
        setAdminMessage("Categoria creada correctamente.");
      }

      resetCategoryForm();
      await loadAdminData();
      await loadCategories();
    } catch (err) {
      console.error("Error al guardar categoria:", err);
      const details = err?.response?.data?.details;
      setAdminError(
        Array.isArray(details) && details.length > 0
          ? details.join(" ")
          : err?.response?.data?.error ||
              err?.response?.data?.detalle ||
              "No se pudo guardar la categoria."
      );
    } finally {
      setSavingCategory(false);
    }
  };

  const saveProduct = async () => {
    try {
      setSavingProduct(true);
      setAdminError("");
      setAdminMessage("");

      const payload = {
        name: productForm.name,
        description: productForm.description,
        price: productForm.price,
        stock: productForm.stock,
        category: productForm.category,
        image: productForm.image,
      };

      if (productForm.id) {
        await axios.patch(
          `${apiUrl}/admin/productos/${productForm.id}`,
          payload,
          await getAdminRequestConfig()
        );
        setAdminMessage("Producto actualizado correctamente.");
      } else {
        await axios.post(`${apiUrl}/admin/productos`, payload, await getAdminRequestConfig());
        setAdminMessage("Producto creado correctamente.");
      }

      resetProductForm();
      await loadAdminData();
    } catch (err) {
      console.error("Error al guardar producto:", err);
      const details = err?.response?.data?.details;
      setAdminError(
        Array.isArray(details) && details.length > 0
          ? details.join(" ")
          : err?.response?.data?.error ||
              err?.response?.data?.detalle ||
              "No se pudo guardar el producto."
      );
    } finally {
      setSavingProduct(false);
    }
  };

  const resizeImageFile = (file) => {
    return new Promise((resolve, reject) => {
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        const largestSide = Math.max(image.width, image.height);

        if (largestSide <= MAX_IMAGE_DIMENSION) {
          URL.revokeObjectURL(imageUrl);
          resolve(file);
          return;
        }

        const scale = MAX_IMAGE_DIMENSION / largestSide;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");

        if (!context) {
          URL.revokeObjectURL(imageUrl);
          reject(new Error("No se pudo procesar la imagen en el navegador."));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(imageUrl);

            if (!blob) {
              reject(new Error("No se pudo generar la imagen optimizada."));
              return;
            }

            resolve(
              new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
                type: "image/jpeg",
              })
            );
          },
          "image/jpeg",
          OUTPUT_IMAGE_QUALITY
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("El archivo seleccionado no pudo leerse como imagen."));
      };

      image.src = imageUrl;
    });
  };

  const uploadProductImage = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setAdminError("Formato no permitido. Usa JPG, PNG o WEBP.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setAdminError("La imagen supera los 5 MB. Elige un archivo mas liviano.");
      event.target.value = "";
      return;
    }

    if (!cloudinaryCloudName || !cloudinaryUploadPreset) {
      setAdminError(
        "Faltan las variables de Cloudinary. Configura VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET."
      );
      event.target.value = "";
      return;
    }

    try {
      setUploadingImage(true);
      setAdminError("");
      setAdminMessage("");

      const optimizedFile = await resizeImageFile(file);

      const formData = new FormData();
      formData.append("file", optimizedFile);
      formData.append("upload_preset", cloudinaryUploadPreset);
      console.info("Cloudinary upload config", {
        cloudName: cloudinaryCloudName,
        uploadPreset: cloudinaryUploadPreset,
      });

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok || !data.secure_url) {
        throw new Error(
          data?.error?.message
            ? `${data.error.message}. Cloud: ${cloudinaryCloudName}. Preset: ${cloudinaryUploadPreset}.`
            : "No se pudo subir la imagen"
        );
      }

      setProductForm((prev) => ({
        ...prev,
        image: data.secure_url,
      }));

      if (productForm.id) {
        await axios.patch(
          `${apiUrl}/admin/productos/${productForm.id}`,
          {
            image: data.secure_url,
          },
          await getAdminRequestConfig()
        );
        await loadAdminData();
        setAdminMessage("Imagen subida y guardada en el producto.");
      } else {
        setAdminMessage("Imagen subida. Completa el producto y guardalo.");
      }
    } catch (err) {
      console.error("Error al subir imagen a Cloudinary:", err);
      setAdminError(err.message || "No se pudo subir la imagen.");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  };

  const uploadCategoryImage = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setAdminError("Formato no permitido. Usa JPG, PNG o WEBP.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setAdminError("La imagen supera los 5 MB. Elige un archivo mas liviano.");
      event.target.value = "";
      return;
    }

    if (!cloudinaryCloudName || !cloudinaryUploadPreset) {
      setAdminError(
        "Faltan las variables de Cloudinary. Configura VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET."
      );
      event.target.value = "";
      return;
    }

    try {
      setUploadingCategoryImage(true);
      setAdminError("");
      setAdminMessage("");

      const optimizedFile = await resizeImageFile(file);
      const formData = new FormData();
      formData.append("file", optimizedFile);
      formData.append("upload_preset", cloudinaryUploadPreset);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok || !data.secure_url) {
        throw new Error(data?.error?.message || "No se pudo subir la imagen");
      }

      setCategoryForm((prev) => ({
        ...prev,
        image: data.secure_url,
      }));
      setAdminMessage("Imagen subida. Guarda la categoria para publicarla.");
    } catch (err) {
      console.error("Error al subir imagen de categoria a Cloudinary:", err);
      setAdminError(err.message || "No se pudo subir la imagen.");
    } finally {
      setUploadingCategoryImage(false);
      event.target.value = "";
    }
  };

  const deleteProduct = async (productId) => {
    try {
      setDeletingProductId(productId);
      setAdminError("");
      setAdminMessage("");

      await axios.delete(`${apiUrl}/admin/productos/${productId}`, await getAdminRequestConfig());
      setAdminMessage("Producto eliminado correctamente.");

      if (productForm.id === productId) {
        resetProductForm();
      }

      await loadAdminData();
    } catch (err) {
      console.error("Error al eliminar producto:", err);
      setAdminError(
        err?.response?.data?.error ||
          err?.response?.data?.detalle ||
          "No se pudo eliminar el producto."
      );
    } finally {
      setDeletingProductId(null);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      setStatusSavingId(orderId);
      setAdminError("");
      setAdminMessage("");

      const response = await axios.patch(
        `${apiUrl}/admin/pedidos/${orderId}/status`,
        {
          status,
        },
        await getAdminRequestConfig()
      );

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? response.data.order : order))
      );
      setAdminMessage(`Pedido #${orderId} actualizado a ${status}.`);
    } catch (err) {
      console.error("Error al actualizar estado:", err);
      setAdminError(
        err?.response?.data?.error ||
          err?.response?.data?.detalle ||
          "No se pudo actualizar el estado del pedido."
      );
    } finally {
      setStatusSavingId(null);
    }
  };

  const deleteCategory = async (categoryId) => {
    try {
      setDeletingCategoryId(categoryId);
      setAdminError("");
      setAdminMessage("");

      await axios.delete(`${apiUrl}/admin/categorias/${categoryId}`, await getAdminRequestConfig());
      setAdminMessage("Categoria eliminada correctamente.");

      if (categoryForm.id === categoryId) {
        resetCategoryForm();
      }

      await loadAdminData();
      await loadCategories();
    } catch (err) {
      console.error("Error al eliminar categoria:", err);
      setAdminError(
        err?.response?.data?.error ||
          err?.response?.data?.detalle ||
          "No se pudo eliminar la categoria."
      );
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const featuredHeroProduct = products.find((product) => product.image) || products[0];
  const categoryItems = categories.length > 0
    ? categories
    : [
        ...new Set(products.map((product) => product.category).filter(Boolean)),
      ].map((categoryName) => ({
        id: categoryName,
        name: categoryName,
        image: products.find((product) => product.category === categoryName)?.image || "",
      }));
  const productsByCategory = products.reduce((groups, product) => {
    const category = product.category?.trim() || "Sin categoria";

    if (!groups[category]) {
      groups[category] = [];
    }

    groups[category].push(product);
    return groups;
  }, {});
  const categorySections = Object.entries(productsByCategory).filter(([category]) => {
    return selectedCategory === "todos" || category === selectedCategory;
  });

  return (
    <div className="page-shell">
      <div className="top-strip">
        <span>Envios y retiros coordinados</span>
        <span>Compra segura por pedido directo</span>
        <span>Atencion personalizada por WhatsApp</span>
      </div>

      <div className="store-header">
        <div className="store-header__brand">
          <SignedOut>
            <SignInButton mode="modal">
              <button type="button" className="brand-login brand-login--header">
                Sueña en Grande
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <button
              type="button"
              className="brand-login brand-login--header"
              onClick={() => setActiveView("shop")}
            >
              Sueña en Grande
            </button>
          </SignedIn>
        </div>

        <nav className="store-header__nav" aria-label="Navegacion principal">
          <button type="button" onClick={() => scrollToSection("inicio")}>
            Inicio
          </button>
          <button type="button" onClick={() => scrollToSection("productos")}>
            Productos
          </button>
          <button type="button" onClick={() => scrollToSection("contacto")}>
            Contacto
          </button>
          {isAdminUser ? (
            <button type="button" onClick={() => setActiveView("admin")}>
              Admin
            </button>
          ) : null}
        </nav>

        <div className="store-header__actions">
          {isAdminUser ? <UserButton /> : null}
          <button type="button" className="cart-chip" onClick={() => setActiveView("shop")}>
            Carrito <strong>{cartTotalQuantity}</strong>
          </button>
        </div>
      </div>

      <header className="hero" id="inicio">
        <div className="hero__copy">
          <p className="eyebrow">Bienestar, hogar y pequenos rituales</p>
          <h1>Aromas y deco para crear espacios con calma</h1>
          <p className="hero__text">
            Aromas, texturas y objetos elegidos para transformar tu casa en un
            refugio calido. Compra simple, atencion cercana y productos con alma.
          </p>
          <div className="hero__nav">
            <span>Productos</span>
            <span>Pedidos por WhatsApp</span>
            <span>Deco & aromas</span>
          </div>
          <div className="hero__actions">
            <button type="button" className="primary-btn" onClick={() => setActiveView("shop")}>
              Ver catalogo
            </button>
            <span>Envios y retiros coordinados por WhatsApp</span>
          </div>
          {apiMessage && <p className="hero__status">{apiMessage}</p>}
        </div>

        <div className="hero__visual" aria-label="Ambiente calido de la tienda">
          {featuredHeroProduct?.image ? (
            <img src={featuredHeroProduct.image} alt={featuredHeroProduct.name} />
          ) : (
            <div className="hero__visual-fallback">
              <span>Sueña</span>
              <strong>Rituales para el hogar</strong>
            </div>
          )}
          <div className="hero__floating-card">
            <span>Seleccion especial</span>
            <strong>{featuredHeroProduct?.category || "Aromas y hogar"}</strong>
          </div>
        </div>

        <div className="hero__aside">
          <div className="badge-card">
            <span>Catalogo</span>
            <strong>{products.length}</strong>
          </div>
          <div className="badge-card badge-card--soft">
            <span>Pedido</span>
            <strong>{cartTotalQuantity}</strong>
          </div>
        </div>
      </header>

      {isAdminUser ? (
        <nav className="view-switcher">
          <button
            type="button"
            className={activeView === "shop" ? "view-switcher__btn is-active" : "view-switcher__btn"}
            onClick={() => setActiveView("shop")}
          >
            Tienda
          </button>
          <button
            type="button"
            className={activeView === "admin" ? "view-switcher__btn is-active" : "view-switcher__btn"}
            onClick={() => setActiveView("admin")}
          >
            Admin
          </button>
        </nav>
      ) : null}

      {loading ? <p className="panel-message">Cargando tienda...</p> : null}
      {error ? <p className="panel-message panel-message--error">{error}</p> : null}

      {!loading && !error && activeView === "shop" ? (
        <main className="shop-layout">
          <section className="panel" id="productos">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Catalogo</p>
                <h2>Productos destacados</h2>
              </div>
              <p className="panel__hint">
                Elegi tus favoritos y arma tu pedido en pocos pasos.
              </p>
            </div>

            <div className="store-benefits">
              <article>
                <span>01</span>
                <strong>Coordinamos tu pedido</strong>
                <p>Retiro o envio segun tu zona, con contacto directo.</p>
              </article>
              <article>
                <span>02</span>
                <strong>Productos seleccionados</strong>
                <p>Aromas, deco y pequenos rituales para el hogar.</p>
              </article>
              <article>
                <span>03</span>
                <strong>Compra simple</strong>
                <p>Armas el carrito y confirmamos todo por WhatsApp.</p>
              </article>
            </div>

            {categoryItems.length > 0 ? (
              <div className="category-showcase" aria-label="Categorias del catalogo">
                <button
                  type="button"
                  className={
                    selectedCategory === "todos"
                      ? "category-item category-item--active"
                      : "category-item"
                  }
                  onClick={() => setSelectedCategory("todos")}
                >
                  <span className="category-item__image category-item__image--all">Todo</span>
                  <strong>Todas</strong>
                  <small>{products.length} productos</small>
                </button>
                {categoryItems.map((category) => {
                  const categoryProductsCount = products.filter(
                    (product) => product.category === category.name
                  ).length;

                  return (
                    <button
                      type="button"
                      className={
                        selectedCategory === category.name
                          ? "category-item category-item--active"
                          : "category-item"
                      }
                      key={category.id}
                      onClick={() => setSelectedCategory(category.name)}
                    >
                      <span className="category-item__image">
                        {category.image ? (
                          <img src={category.image} alt={category.name} />
                        ) : (
                          category.name.slice(0, 1)
                        )}
                      </span>
                      <strong>{category.name}</strong>
                      <small>{categoryProductsCount} productos</small>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {products.length === 0 ? (
              <div className="empty-state">
                <h3>Todavia no hay productos cargados</h3>
                <p>Usa el panel admin para crear el catalogo inicial.</p>
              </div>
            ) : (
              <div className="category-sections">
                {categorySections.map(([category, categoryProducts]) => (
                  <section className="category-section" key={category}>
                    <div className="category-section__header">
                      <div>
                        <p className="eyebrow eyebrow--compact">Categoria</p>
                        <h3>{category}</h3>
                      </div>
                      <span>{categoryProducts.length} productos</span>
                    </div>

                    <div className="product-grid">
                      {categoryProducts.map((product) => {
                        const cartItem = cart.find((item) => item.id === product.id);
                        const remainingStock = product.stock - (cartItem?.quantity || 0);
                        const hasStock = remainingStock > 0;

                        return (
                          <article className="product-card" key={product.id}>
                            <div className="product-card__media">
                              <span className="product-card__badge">
                                {hasStock ? "Envio coordinado" : "Sin stock"}
                              </span>
                              {product.image ? (
                                <img src={product.image} alt={product.name} />
                              ) : (
                                <span>{product.category || "Producto"}</span>
                              )}
                            </div>

                            <div className="product-card__body">
                              <p className="eyebrow eyebrow--compact">
                                {product.category || "Sin categoria"}
                              </p>
                              <h3>{product.name}</h3>
                              <p className="product-card__description">
                                {product.description ||
                                  "Producto ideal para sumar aroma, armonia y calidez al hogar."}
                              </p>

                              <div className="product-card__meta">
                                <strong>{formatPrice(product.price)}</strong>
                                <span
                                  className={
                                    hasStock
                                      ? "stock-pill stock-pill--available"
                                      : "stock-pill stock-pill--empty"
                                  }
                                >
                                  {hasStock ? "En stock" : "Sin stock"}
                                </span>
                              </div>

                              <button
                                type="button"
                                className="primary-btn"
                                onClick={() => addToCart(product)}
                                disabled={!hasStock}
                              >
                                {hasStock ? "Agregar al carrito" : "Sin stock"}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>

          <aside className="panel cart-panel" id="contacto">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Pedido</p>
                <h2>Tu pedido</h2>
              </div>
              <span className="checkout-status">
                {cart.length === 0 ? "Sin productos" : `${cartTotalQuantity} items`}
              </span>
            </div>

            <div className="checkout-steps">
              <span>1. Elegi</span>
              <span>2. Completa</span>
              <span>3. Confirmamos</span>
            </div>

            {cart.length === 0 ? (
              <div className="empty-state empty-state--soft">
                {lastOrderId ? (
                  <>
                    <p className="eyebrow eyebrow--compact">Pedido recibido</p>
                    <h3>Gracias por tu compra</h3>
                    <p>
                      Tu pedido #{lastOrderId} ya quedo registrado. Te vamos a contactar
                      por WhatsApp para confirmar entrega y forma de pago.
                    </p>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => scrollToSection("productos")}
                    >
                      Volver al catalogo
                    </button>
                  </>
                ) : (
                  <>
                    <h3>Tu carrito esta vacio</h3>
                    <p>Agrega productos para comenzar el pedido.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <article className="cart-item" key={item.id}>
                      <div>
                        <h3>{item.name}</h3>
                        <p>
                          {formatPrice(item.price)} x {item.quantity}
                        </p>
                      </div>

                      <div className="cart-item__controls">
                        <div className="qty-control">
                          <button type="button" onClick={() => decreaseQuantity(item.id)}>
                            -
                          </button>
                          <span>{item.quantity}</span>
                          <button type="button" onClick={() => increaseQuantity(item.id)}>
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => removeFromCart(item.id)}
                        >
                          Quitar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="summary-card">
                  <div className="summary-row">
                    <span>Productos</span>
                    <strong>{cartTotalQuantity}</strong>
                  </div>
                  <div className="summary-row summary-row--total">
                    <span>Total</span>
                    <strong>{formatPrice(cartTotalAmount)}</strong>
                  </div>
                </div>
              </>
            )}

            <div className="form-card">
              <div className="checkout-intro">
                <strong>Datos para coordinar</strong>
                <p>Te contactamos por WhatsApp para confirmar retiro o envio.</p>
              </div>

              <div className="field-group">
                <label htmlFor="customerName">Nombre</label>
                <input
                  id="customerName"
                  type="text"
                  value={checkout.customerName}
                  onChange={(event) => updateCheckoutField("customerName", event.target.value)}
                  placeholder="Como te llamas"
                />
                {checkoutErrors.customerName ? (
                  <p className="field-error">{checkoutErrors.customerName}</p>
                ) : null}
              </div>

              <div className="field-group">
                <label htmlFor="customerPhone">Telefono</label>
                <input
                  id="customerPhone"
                  type="text"
                  value={checkout.customerPhone}
                  onChange={(event) => updateCheckoutField("customerPhone", event.target.value)}
                  placeholder="Tu contacto"
                />
                {checkoutErrors.customerPhone ? (
                  <p className="field-error">{checkoutErrors.customerPhone}</p>
                ) : null}
              </div>

              <div className="field-group">
                <label htmlFor="deliveryMethod">Metodo de entrega</label>
                <select
                  id="deliveryMethod"
                  value={checkout.deliveryMethod}
                  onChange={(event) => updateCheckoutField("deliveryMethod", event.target.value)}
                >
                  <option value="retiro">Retiro</option>
                  <option value="envio">Envio</option>
                </select>
              </div>

              <div className="field-group">
                <label htmlFor="address">
                  Direccion {checkout.deliveryMethod === "envio" ? "(obligatoria)" : "(opcional)"}
                </label>
                <input
                  id="address"
                  type="text"
                  value={checkout.address}
                  onChange={(event) => updateCheckoutField("address", event.target.value)}
                  placeholder="Calle, altura y referencia"
                />
                {checkoutErrors.address ? (
                  <p className="field-error">{checkoutErrors.address}</p>
                ) : null}
              </div>

              <div className="field-group">
                <label htmlFor="notes">Notas</label>
                <textarea
                  id="notes"
                  rows="3"
                  value={checkout.notes}
                  onChange={(event) => updateCheckoutField("notes", event.target.value)}
                  placeholder="Indicaciones adicionales para el pedido"
                />
              </div>

              {checkoutErrors.cart ? <p className="field-error">{checkoutErrors.cart}</p> : null}
              {orderError ? <p className="feedback feedback--error">{orderError}</p> : null}
              {orderMessage ? <p className="feedback feedback--success">{orderMessage}</p> : null}

              {cart.length > 0 ? (
                <div className="mobile-checkout-summary">
                  <span>Total del pedido</span>
                  <strong>{formatPrice(cartTotalAmount)}</strong>
                </div>
              ) : null}

              <button
                type="button"
                className="primary-btn primary-btn--full"
                onClick={submitOrder}
                disabled={submittingOrder}
              >
                {submittingOrder ? "Enviando pedido..." : "Confirmar pedido"}
              </button>
            </div>
          </aside>
        </main>
      ) : null}

      {!loading && !error && activeView === "admin" ? (
        <SignedOut>
          <main className="panel auth-panel">
            <p className="eyebrow">Acceso interno</p>
            <h2>Ingresar al administrador</h2>
            <p>
              Inicia sesion con una cuenta autorizada de Clerk para gestionar pedidos,
              productos e imagenes.
            </p>
            <SignInButton mode="modal">
              <button type="button" className="primary-btn">
                Iniciar sesion
              </button>
            </SignInButton>
          </main>
        </SignedOut>
      ) : null}

      {!loading && !error && activeView === "admin" && isSignedIn && !isAdminUser ? (
        <main className="panel auth-panel">
          <p className="eyebrow">Acceso restringido</p>
          <h2>No tenes permisos de administrador</h2>
          <p>Tu cuenta inicio sesion correctamente, pero no esta autorizada para gestionar la tienda.</p>
          <UserButton />
        </main>
      ) : null}

      {!loading && !error && activeView === "admin" && isAdminUser ? (
        <SignedIn>
          <main className="admin-layout">
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Panel interno</p>
                <h2>Pedidos recibidos</h2>
              </div>
              <button type="button" className="secondary-btn" onClick={() => void loadAdminData()}>
                Recargar datos
              </button>
            </div>

            {adminLoading ? <p className="panel-message">Cargando panel admin...</p> : null}
            {adminError ? <p className="panel-message panel-message--error">{adminError}</p> : null}
            {adminMessage ? <p className="panel-message panel-message--success">{adminMessage}</p> : null}

            <div className="metrics-grid">
              <article className="metric-card">
                <span>Pendientes</span>
                <strong>{adminMetrics.pendingOrders}</strong>
                <p>Pedidos esperando gestion</p>
              </article>
              <article className="metric-card">
                <span>Ventas</span>
                <strong>{formatPrice(adminMetrics.totalSales)}</strong>
                <p>Total no cancelado</p>
              </article>
              <article className="metric-card">
                <span>Entregados</span>
                <strong>{adminMetrics.deliveredOrders}</strong>
                <p>Pedidos completados</p>
              </article>
              <article className="metric-card metric-card--alert">
                <span>Stock bajo</span>
                <strong>{adminMetrics.lowStockProducts}</strong>
                <p>Productos con 3 o menos</p>
              </article>
            </div>

            <div className="orders-toolbar">
              <div className="field-group">
                <label htmlFor="orderSearch">Buscar pedido</label>
                <input
                  id="orderSearch"
                  type="text"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                  placeholder="Cliente, telefono, direccion o numero"
                />
              </div>

              <div className="field-group">
                <label htmlFor="orderStatusFilter">Filtrar por estado</label>
                <select
                  id="orderStatusFilter"
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value)}
                >
                  <option value="todos">Todos los estados</option>
                  {ORDER_STATUSES.map((statusOption) => (
                    <option key={statusOption.value} value={statusOption.value}>
                      {statusOption.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="orders-count">
                <span>Resultados</span>
                <strong>{filteredOrders.length}</strong>
              </div>
            </div>

            {!adminLoading && orders.length === 0 ? (
              <div className="empty-state">
                <h3>No hay pedidos registrados</h3>
                <p>Cuando lleguen compras apareceran aca con su detalle.</p>
              </div>
            ) : !adminLoading && filteredOrders.length === 0 ? (
              <div className="empty-state">
                <h3>No encontramos pedidos</h3>
                <p>Probá cambiar el estado seleccionado o limpiar la busqueda.</p>
              </div>
            ) : (
              <div className="orders-list">
                {filteredOrders.map((order) => (
                  <article
                    className={order.status === "pendiente" ? "order-card order-card--pending" : "order-card"}
                    key={order.id}
                  >
                    <div className="order-card__top">
                      <div>
                        <p className="eyebrow eyebrow--compact">Pedido #{order.id}</p>
                        <h3>{order.customerName}</h3>
                        <p className="order-card__meta">
                          {order.customerPhone} - {order.deliveryMethod}
                        </p>
                        <p className="order-card__date">{formatOrderDate(order.createdAt)}</p>
                      </div>

                      <div className="order-card__status">
                        <span>{formatPrice(order.total)}</span>
                        <select
                          value={order.status}
                          onChange={(event) => void updateOrderStatus(order.id, event.target.value)}
                          disabled={statusSavingId === order.id}
                        >
                          {ORDER_STATUSES.map((statusOption) => (
                            <option key={statusOption.value} value={statusOption.value}>
                              {statusOption.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="order-card__details">
                      <p>
                        <strong>Direccion:</strong> {order.address || "Retira en punto acordado"}
                      </p>
                      <p>
                        <strong>Notas:</strong> {order.notes || "Sin notas"}
                      </p>
                    </div>

                    <div className="order-quick-actions">
                      {order.status === "pendiente" ? (
                        <button
                          type="button"
                          className="quick-status-btn"
                          onClick={() => void updateOrderStatus(order.id, "confirmado")}
                          disabled={statusSavingId === order.id}
                        >
                          Confirmar
                        </button>
                      ) : null}
                      {["pendiente", "confirmado"].includes(order.status) ? (
                        <button
                          type="button"
                          className="quick-status-btn"
                          onClick={() => void updateOrderStatus(order.id, "en_preparacion")}
                          disabled={statusSavingId === order.id}
                        >
                          Preparar
                        </button>
                      ) : null}
                      {order.status !== "entregado" && order.status !== "cancelado" ? (
                        <button
                          type="button"
                          className="quick-status-btn quick-status-btn--success"
                          onClick={() => void updateOrderStatus(order.id, "entregado")}
                          disabled={statusSavingId === order.id}
                        >
                          Entregado
                        </button>
                      ) : null}
                    </div>

                    <div className="order-card__actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => void sendOrderToWhatsApp(order)}
                      >
                        Enviar por WhatsApp
                      </button>
                    </div>

                    <div className="order-items">
                      {order.items.map((item) => (
                        <div className="order-item" key={item.id}>
                          <span>
                            {item.productName} x {item.quantity}
                          </span>
                          <strong>{formatPrice(item.subtotal)}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="admin-side">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Categorias</p>
                  <h2>{categoryForm.id ? "Editar categoria" : "Nueva categoria"}</h2>
                </div>
                {categoryForm.id ? (
                  <button type="button" className="secondary-btn" onClick={resetCategoryForm}>
                    Cancelar
                  </button>
                ) : null}
              </div>

              <div className="form-grid">
                <div className="field-group">
                  <label htmlFor="categoryName">Nombre</label>
                  <input
                    id="categoryName"
                    type="text"
                    value={categoryForm.name}
                    onChange={(event) =>
                      setCategoryForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Sahumerios, velas, deco..."
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="categoryImageFile">Imagen</label>
                  <input
                    id="categoryImageFile"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void uploadCategoryImage(event)}
                    disabled={uploadingCategoryImage}
                  />
                  <p className="field-help">
                    {uploadingCategoryImage
                      ? "Subiendo imagen..."
                      : "Se usa como portada de la categoria."}
                  </p>
                </div>

                <div className="field-group field-group--full">
                  <label htmlFor="categoryImage">URL de imagen</label>
                  <input
                    id="categoryImage"
                    type="text"
                    value={categoryForm.image}
                    onChange={(event) =>
                      setCategoryForm((prev) => ({ ...prev, image: event.target.value }))
                    }
                    placeholder="https://..."
                  />
                </div>

                {categoryForm.image ? (
                  <div className="field-group field-group--full">
                    <div className="image-preview category-preview">
                      <img src={categoryForm.image} alt={categoryForm.name || "Categoria"} />
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="primary-btn primary-btn--full"
                onClick={saveCategory}
                disabled={savingCategory || uploadingCategoryImage}
              >
                {savingCategory
                  ? "Guardando..."
                  : categoryForm.id
                    ? "Actualizar categoria"
                    : "Crear categoria"}
              </button>

              {categories.length > 0 ? (
                <div className="admin-categories">
                  {categories.map((category) => (
                    <article className="admin-category-card" key={category.id}>
                      <div className="admin-category-card__image">
                        {category.image ? (
                          <img src={category.image} alt={category.name} />
                        ) : (
                          <span>{category.name.slice(0, 1)}</span>
                        )}
                      </div>
                      <div>
                        <h3>{category.name}</h3>
                        <p>
                          {products.filter((product) => product.category === category.name).length} productos
                        </p>
                      </div>
                      <div className="admin-category-card__actions">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => startEditingCategory(category)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={() => void deleteCategory(category.id)}
                          disabled={deletingCategoryId === category.id}
                        >
                          {deletingCategoryId === category.id ? "Eliminando..." : "Eliminar"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Catalogo</p>
                  <h2>{productForm.id ? "Editar producto" : "Nuevo producto"}</h2>
                  {productForm.id ? (
                    <p className="panel__subcopy">Estas editando un producto existente.</p>
                  ) : (
                    <p className="panel__subcopy">Completa los datos para sumarlo a la tienda.</p>
                  )}
                </div>
                {productForm.id ? (
                  <button type="button" className="secondary-btn" onClick={resetProductForm}>
                    Cancelar edicion
                  </button>
                ) : null}
              </div>

              <div className="form-grid">
                <div className="field-group">
                  <label htmlFor="productName">Nombre</label>
                  <input
                    id="productName"
                    type="text"
                    value={productForm.name}
                    onChange={(event) =>
                      setProductForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Nombre del producto"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="productCategory">Categoria</label>
                  {categories.length > 0 ? (
                    <select
                      id="productCategory"
                      value={productForm.category}
                      onChange={(event) =>
                        setProductForm((prev) => ({ ...prev, category: event.target.value }))
                      }
                    >
                      <option value="">Sin categoria</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="productCategory"
                      type="text"
                      value={productForm.category}
                      onChange={(event) =>
                        setProductForm((prev) => ({ ...prev, category: event.target.value }))
                      }
                      placeholder="Primero crea categorias arriba"
                    />
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="productPrice">Precio</label>
                  <input
                    id="productPrice"
                    type="number"
                    min="0"
                    value={productForm.price}
                    onChange={(event) =>
                      setProductForm((prev) => ({ ...prev, price: event.target.value }))
                    }
                    placeholder="0"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="productStock">Stock</label>
                  <input
                    id="productStock"
                    type="number"
                    min="0"
                    value={productForm.stock}
                    onChange={(event) =>
                      setProductForm((prev) => ({ ...prev, stock: event.target.value }))
                    }
                    placeholder="0"
                  />
                </div>

                <div className="field-group field-group--full">
                  <label htmlFor="productImage">URL de imagen</label>
                  <input
                    id="productImage"
                    type="text"
                    value={productForm.image}
                    onChange={(event) =>
                      setProductForm((prev) => ({ ...prev, image: event.target.value }))
                    }
                    placeholder="https://..."
                  />
                </div>

                <div className="field-group field-group--full">
                  <label htmlFor="productImageFile">Subir imagen a Cloudinary</label>
                  <input
                    id="productImageFile"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void uploadProductImage(event)}
                    disabled={uploadingImage}
                  />
                  <p className="field-help">
                    {uploadingImage
                      ? "Subiendo imagen..."
                      : "Acepta JPG, PNG o WEBP de hasta 5 MB. Las imagenes grandes se reducen antes de subir."}
                  </p>
                </div>

                {productForm.image ? (
                  <div className="field-group field-group--full">
                    <div className="image-preview__header">
                      <label>Vista previa</label>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() =>
                          setProductForm((prev) => ({
                            ...prev,
                            image: "",
                          }))
                        }
                      >
                        Quitar imagen
                      </button>
                    </div>
                    <div className="image-preview">
                      <img src={productForm.image} alt={productForm.name || "Vista previa"} />
                    </div>
                  </div>
                ) : null}

                <div className="field-group field-group--full">
                  <label htmlFor="productDescription">Descripcion</label>
                  <textarea
                    id="productDescription"
                    rows="4"
                    value={productForm.description}
                    onChange={(event) =>
                      setProductForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                    placeholder="Describe el producto y su atmosfera"
                  />
                </div>
              </div>

              <button
                type="button"
                className="primary-btn primary-btn--full"
                onClick={saveProduct}
                disabled={savingProduct || uploadingImage}
              >
                {savingProduct
                  ? "Guardando..."
                  : productForm.id
                    ? "Actualizar producto"
                    : "Crear producto"}
              </button>
            </div>

            <div className="panel">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Stock actual</p>
                  <h2>Productos cargados</h2>
                </div>
              </div>

              <div className="admin-catalog-toolbar">
                <div className="field-group">
                  <label htmlFor="adminProductSearch">Buscar producto</label>
                  <input
                    id="adminProductSearch"
                    type="text"
                    value={adminProductSearch}
                    onChange={(event) => setAdminProductSearch(event.target.value)}
                    placeholder="Nombre, descripcion o precio"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="adminProductCategoryFilter">Categoria</label>
                  <select
                    id="adminProductCategoryFilter"
                    value={adminProductCategoryFilter}
                    onChange={(event) => setAdminProductCategoryFilter(event.target.value)}
                  >
                    <option value="todas">Todas</option>
                    <option value="Sin categoria">Sin categoria</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="orders-count">
                  <span>Productos</span>
                  <strong>{filteredAdminProducts.length}</strong>
                </div>
              </div>

              <div className="admin-products">
                {filteredAdminProducts.length === 0 ? (
                  <div className="empty-state empty-state--soft">
                    <h3>No encontramos productos</h3>
                    <p>Proba cambiar la busqueda o el filtro de categoria.</p>
                  </div>
                ) : (
                  filteredAdminProducts.map((product) => {
                    const productStock = Number(product.stock || 0);

                    return (
                      <article className="admin-product-card" key={product.id}>
                        <div className="admin-product-card__main">
                          <div className="admin-product-card__thumb">
                            {product.image ? (
                              <img src={product.image} alt={product.name} />
                            ) : (
                              <span>{product.category?.slice(0, 1) || "P"}</span>
                            )}
                          </div>

                          <div>
                            <p className="eyebrow eyebrow--compact">
                              {product.category || "Sin categoria"}
                            </p>
                            <h3>{product.name}</h3>
                            <p>{formatPrice(product.price)} - Stock {product.stock}</p>
                            <div className="admin-product-flags">
                              {!product.image ? <span>Sin imagen</span> : null}
                              {productStock === 0 ? <span>Sin stock</span> : null}
                              {productStock > 0 && productStock <= 3 ? <span>Stock bajo</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="admin-product-card__actions">
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => startEditingProduct(product)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => void deleteProduct(product.id)}
                            disabled={deletingProductId === product.id}
                          >
                            {deletingProductId === product.id ? "Eliminando..." : "Eliminar"}
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </section>
          </main>
        </SignedIn>
      ) : null}
    </div>
  );
}
