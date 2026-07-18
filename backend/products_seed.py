CS = ["S", "M", "L", "XL", "XXL"]
WS = ["XS", "S", "M", "L", "XL"]
JN = ["28", "30", "32", "34", "36"]
FS = ["Free Size"]


def P(pid, name, category, subcategory, price, mrp, image, sizes, badge=None, color="Multicolour", fabric="Premium Blend", description=None):
    return {
        "id": pid, "name": name, "category": category, "subcategory": subcategory,
        "price": price, "mrp": mrp, "image": image, "sizes": sizes, "badge": badge,
        "color": color, "fabric": fabric,
        "description": description or f"{name} from the CRESTUS edit — {subcategory.lower()} crafted for comfort, fit and everyday style.",
    }


M = "https://images.meesho.com/images/products"
PR = "https://pruyug.com/cloth_images"

SAMPLE_PRODUCTS = [
    # ---- Women (Pruyug edit) ----
    P("w-midnight-slip", "Midnight Satin Slip Dress", "women", "Dresses", 2499, 3999, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/6d6529dae61b149cec883f91c96c50de10e043cc8dcc4d57817103b766982fd1.png", WS, "New", "Midnight Blue", "Satin"),
    P("w-pearl-shirt-dress", "Pearl Detail Shirt Dress", "women", "Dresses", 2299, 3799, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/a905eec471aad13a4fbb541b5533ff5c5acacb6ec9a12467975dabf5352ace85.png", WS, None, "Pearl White", "Poly Crepe"),
    P("w-peach-kurta", "Peach Embroidered Kurta", "women", "Kurtis", 1599, 2699, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/658c73f77abf1e22e563420e751d02eb9ea92fd0919a0028fb26d150fa0661ee.png", WS, None, "Peach", "Cotton Blend"),
    P("w-sunset-tiered", "Sunset Tiered Dress", "women", "Dresses", 2399, 3699, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/090019568246f9d3d506c06cbbbd6f86bfa92d278291fd83fbab2ba719abde6a.png", WS, None, "Sunset Orange", "Rayon"),
    P("w-brown-kurta", "Dark Brown Embroidered Kurta", "women", "Kurtis", 1599, 2799, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/d5cb7ce1b7f4766924e230d21460a4ac926e23975c52aa845e11a309685e590d.png", WS, None, "Dark Brown", "Cotton Blend"),
    P("w-black-kurta", "Black Printed Cotton Kurta", "women", "Kurtis", 2199, 3799, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/ae3bc9575963ef218665d0400e69deb6b6f356072ae585c3875fd268043996c0.png", WS, "Bestseller", "Black", "Pure Cotton"),
    P("w-olive-anarkali", "Olive Floral Anarkali Dress", "women", "Dresses", 2599, 3999, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/81be7c1ceffb0a0e3e8eb38cfd2ade0ac5848dd0b0bbda2cd1c298f6de1e1722.png", WS, None, "Olive", "Georgette"),
    P("w-sunset-kurta", "Sunset Embroidered Kurta", "women", "Kurtis", 1699, 2799, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/e4411d74dfdf19fefee91289602101dc97794e8f5953743f8a0019a34663279b.png", WS, "New", "Sunset Yellow", "Cotton Blend"),
    P("w-linen-coord", "Linen Co-ord Set — Oatmeal", "women", "Co-ord Sets", 1999, 3499, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/41ccab0e75ff0a8137585fedfe3bdb5c6b83b66e19a816b34373e4746092c10d.png", WS, "New", "Oatmeal", "Linen Blend"),
    P("w-red-floral-kurta", "Red Floral Print Kurta", "women", "Kurtis", 1599, 2699, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/7d020a96bcbc67cb5de19465955e8353683d6f92e2419cafd65468d63d9c0e9e.png", WS, "New", "Red", "Rayon"),
    P("w-purple-coord", "Purple Printed Co-ord Set", "women", "Co-ord Sets", 1399, 2299, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/ad053a5bd081f3999ef8a3124f370e756915f46fa43d0ee1a3b4c595275f31a9.png", WS, "New", "Purple", "Rayon"),
    P("w-shibori-saree", "Trendy Shibori Fancy Saree", "women", "Sarees", 1199, 1349, f"{M}/383474406/rsthw_512.webp?width=360", FS, None, "Indigo", "Georgette"),
    P("w-sirosky-saree", "Abhisarika Sirosky Work Saree", "women", "Sarees", 1249, 1399, f"{M}/541121290/cntih_512.webp?width=360", FS, None, "Multicolour", "Silk Blend"),

    # ---- Men (Pruyug edit) ----
    P("m-rain-suit", "Urbane Graceful Rain Suit", "men", "Jackets", 1499, 1699, f"{M}/41980623/inueq_512.webp?width=360", CS, None, "Navy", "Waterproof Polyester"),
    P("m-partywear-2pack", "Pack of 2 Partywear Shirts", "men", "Shirts", 1299, 1499, f"{M}/40764135/x6l3q_512.webp?width=360", CS, None, "Multicolour", "Cotton Blend"),
    P("m-trendy-tee", "Trendy Elegant T-Shirt", "men", "T-Shirts", 1099, 1249, f"{M}/91388895/ijjhe_512.webp?width=360", CS, "New", "Multicolour", "Cotton"),
    P("m-knitted-shirt", "Stylish Knitted Shirt", "men", "Shirts", 1149, 1299, f"{M}/528142282/ujxhi_512.webp?width=360", CS, None, "Beige", "Knitted Cotton"),
    P("m-latest-shirt", "Trendy Latest Shirt", "men", "Shirts", 1049, 1399, f"{M}/382911951/aq5vj_512.webp?width=360", CS, None, "Multicolour", "Cotton Blend"),
    P("m-urbane-shirt", "Urbane Partywear Shirt", "men", "Shirts", 1199, 1349, f"{M}/500401403/tg0jv_512.webp?width=360", CS, None, "Multicolour", "Satin Blend"),
    P("m-fancy-shirt", "Fancy Graceful Shirt", "men", "Shirts", 1249, 1399, f"{M}/541773415/7rqim_512.webp?width=360", CS, None, "Multicolour", "Cotton Blend"),
    P("m-linen-set", "Linen Tie-Waist Set", "men", "Co-ord Sets", 1899, 3099, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/3d23c566445d935ab1991697b27cfb11be59e99e2c2ada4768f0103b7743a17f.png", CS, "New", "Natural", "Linen Blend"),
    P("m-polo-navy", "Yellow & Navy Polo T-Shirt", "men", "T-Shirts", 1499, 2499, "https://static.prod-images.emergentagent.com/jobs/f89c7927-1e8b-4177-b57a-7abbe78d832f/images/791cd4837c7ce1b92c7155c6252453b20e0b0501929761edfc340a618da25968.png", CS, "New", "Yellow/Navy", "Pique Cotton"),
    P("m-glam-shirt", "Trendy Glamorous Shirt", "men", "Shirts", 1099, 1299, f"{M}/50094957/zgqcm_512.webp?width=360", CS, None, "Multicolour", "Cotton Blend"),
    P("m-gym-vest", "Classic Gym Vest", "men", "Vests", 1049, 1199, f"{M}/293751425/lhqua_512.webp?width=360", CS, "New", "Multicolour", "Cotton"),

    # ---- Men (BrandClothzy edit) ----
    P("m-ravishing-shirt", "Pretty Ravishing Shirt", "men", "Shirts", 606, 1166, f"{M}/44175508/bbvuf_512.webp?width=360", CS, "Bestseller", "Multicolour", "Cotton Blend"),
    P("m-classy-tee", "Classy Partywear T-Shirt", "men", "T-Shirts", 930, 930, f"{M}/273087421/whumg_512.webp?width=360", CS, "Bestseller", "Multicolour", "Cotton Blend"),
    P("m-arianna-jeans", "Arianna Fashionista Jeans", "men", "Jeans", 1313, 1313, f"{M}/4812797/1_512.webp?width=360", JN, "Bestseller", "Blue", "Stretch Denim"),
    P("m-sj-trousers", "Sam & Jack Trousers", "men", "Trousers", 1386, 1386, f"{M}/7115185/7dc4c_512.webp?width=360", JN, "Bestseller", "Grey", "Poly Viscose"),
    P("m-track-pants", "Elegant Unique Track Pants", "men", "Track Pants", 497, 1082, f"{M}/70145947/pztra_512.webp?width=360", CS, "Bestseller", "Black", "Poly Lycra"),
    P("m-stylus-vest", "Stylus Vest", "men", "Vests", 1061, 1061, f"{M}/88793806/uq0vn_512.webp?width=360", CS, "Bestseller", "White", "Cotton"),
    P("m-kurta-set", "Fashionable Kurta Set", "men", "Ethnic Wear", 1309, 1309, f"{M}/40007079/ykqwx_512.webp?width=360", CS, "Bestseller", "Multicolour", "Cotton Blend"),
    P("m-glam-shorts", "Fashionable Glamorous Shorts", "men", "Shorts", 633, 1187, f"{M}/75098693/ngg6d_512.webp?width=360", CS, "Bestseller", "Multicolour", "Cotton Blend"),
    P("m-urbane-jacket", "Urbane Fabulous Jacket", "men", "Jackets", 738, 1267, f"{M}/26303587/gchqk_512.webp?width=360", CS, "Bestseller", "Multicolour", "Polyester"),
    P("m-ethnic-shirt", "Ethnic Premium Cotton Printed Shirt", "men", "Shirts", 1054, 1054, f"{M}/2653067/1_512.webp?width=360", CS, "New", "Multicolour", "Pure Cotton"),
    P("m-fang-jeans", "FANG Jeans", "men", "Jeans", 1249, 1249, f"{M}/46295400/lsf5p_512.webp?width=360", JN, "New", "Blue", "Denim"),
    P("m-fancy-jeans", "Fancy Fashionista Jeans", "men", "Jeans", 631, 1186, f"{M}/64144768/bjctb_512.webp?width=360", JN, "New", "Blue", "Stretch Denim"),
    P("m-designer-trousers", "Designer Modern Trousers", "men", "Trousers", 1071, 1071, f"{M}/287409981/loxll_512.webp?width=360", JN, "New", "Beige", "Poly Viscose"),
    P("m-zeffit-track", "Zeffit Track Pants", "men", "Track Pants", 577, 1144, f"{M}/1707198/1_512.webp?width=360", CS, "New", "Grey", "Poly Cotton"),
    P("m-stylish-kurta", "Stylish Kurta Set", "men", "Ethnic Wear", 553, 1126, f"{M}/455799004/acsls_512.webp?width=360", CS, "New", "Multicolour", "Cotton Blend"),
    P("m-active-shorts", "Casual Active Shorts", "men", "Shorts", 883, 883, f"{M}/54241863/n59bw_512.webp?width=360", CS, "New", "Multicolour", "Poly Cotton"),
    P("m-graceful-jacket", "Pretty Graceful Jacket", "men", "Jackets", 881, 1378, f"{M}/18342280/nzehy_512.webp?width=360", CS, "New", "Multicolour", "Polyester"),
    P("m-blazer-classic", "Classic Fashionista Blazer", "men", "Jackets", 1029, 1491, f"{M}/87533209/yzlsj_512.webp?width=360", ["38", "40", "42", "44"], "New", "Multicolour", "Poly Viscose"),

    # ---- Women (BrandClothzy edit) ----
    P("w-charvi-saree", "Charvi Fashionable Saree", "women", "Sarees", 601, 1162, f"{M}/521238874/klpg5_512.webp?width=360", FS, "Bestseller", "Multicolour", "Georgette"),
    P("w-banita-kurti", "Rayon Banita Alluring Kurti", "women", "Kurtis", 974, 974, f"{M}/386229233/nlubb_512.webp?width=360", WS, "Bestseller", "Multicolour", "Rayon"),
    P("w-cotton-kurta-set", "Cotton Trendy Kurta Set", "women", "Kurta Sets", 1086, 1086, f"{M}/435899553/9vr0k_512.webp?width=360", WS, "Bestseller", "Multicolour", "Pure Cotton"),
    P("w-charvi-dupatta", "Rayon Slub Charvi Dupatta Set", "women", "Dupattas", 1095, 1095, f"{M}/546542300/uuytk_512.webp?width=360", FS, "Bestseller", "Multicolour", "Rayon Slub"),
    P("w-classy-blouse", "Classy Blouse", "women", "Tops & Blouses", 459, 1053, f"{M}/473901562/ojbeo_512.webp?width=360", WS, "Bestseller", "Multicolour", "Silk Blend"),
    P("w-myra-lehenga", "Myra Petite Lehenga", "women", "Lehengas", 714, 1249, f"{M}/517765238/3hdyu_512.webp?width=360", FS, "Bestseller", "Multicolour", "Net & Satin"),
    P("w-trendy-gown", "Trendy Fashionable Gown", "women", "Dresses", 1214, 1214, f"{M}/297415239/5aadc_512.webp?width=360", WS, "Bestseller", "Multicolour", "Georgette"),
    P("w-salwar-suit", "Trendy Alluring Salwar Suit", "women", "Salwar Suits", 1214, 1214, f"{M}/201295920/zby3r_512.webp?width=360", FS, "Bestseller", "Multicolour", "Cotton Blend"),
    P("w-ethnic-skirt", "Aakarsha Fabulous Ethnic Skirt", "women", "Ethnic Wear", 1023, 1023, f"{M}/465067865/qn36z_512.webp?width=360", FS, "Bestseller", "Multicolour", "Rayon"),
    P("w-alisha-saree", "Alisha Refined Saree", "women", "Sarees", 479, 1068, f"{M}/438377875/qvlfv_512.webp?width=360", FS, "New", "Multicolour", "Georgette"),
    P("w-aishani-kurti", "Poly Crepe Aishani Kurti", "women", "Kurtis", 375, 988, f"{M}/497051184/md6hc_512.webp?width=360", WS, "New", "Multicolour", "Poly Crepe"),
    P("w-adrika-set", "Cotton Adrika Kurta Set", "women", "Kurta Sets", 402, 1009, f"{M}/538169360/vzpvm_512.webp?width=360", WS, "New", "Multicolour", "Pure Cotton"),
    P("w-chanderi-dupatta", "Chanderi Cotton Dupatta Set", "women", "Dupattas", 819, 1330, f"{M}/481263934/jcg7p_512.webp?width=360", FS, "New", "Multicolour", "Chanderi Cotton"),
    P("w-myra-fab-lehenga", "Myra Fabulous Lehenga", "women", "Lehengas", 826, 1336, f"{M}/394804191/sx1en_512.webp?width=360", FS, "New", "Multicolour", "Net & Satin"),
    P("w-ethnic-gown", "Ethnic Gown", "women", "Dresses", 532, 1109, f"{M}/498511327/wbeyb_512.webp?width=360", WS, "New", "Multicolour", "Rayon"),
    P("w-myra-salwar", "Myra Graceful Salwar Suit", "women", "Salwar Suits", 886, 1382, f"{M}/43814823/hcbql_512.webp?width=360", FS, "New", "Multicolour", "Cotton Blend"),
    P("w-jivika-skirt", "Jivika Refined Ethnic Skirt", "women", "Ethnic Wear", 1049, 1049, f"{M}/374114608/qhshj_512.webp?width=360", FS, "New", "Multicolour", "Rayon"),
]
