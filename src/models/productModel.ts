import { DataTypes, Model, type ModelStatic } from 'sequelize';
import { PRODUCT_CATEGORIES } from '../constants';
import { type ProductAttributes } from '../types/models/productTypes';

export class Product
    extends Model<ProductAttributes>
    implements ProductAttributes
{
    id: number;
    name: string;
    price: number;
    category: string;
    sizes: string[];
    shortDescription: string;
    longDescription: string;
    available: boolean;
    imageURL: string;
}

export function productFactory(sequelize): ModelStatic<Product> {
    return Product.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            price: {
                type: DataTypes.FLOAT(4),
                allowNull: false,
            },
            category: {
                type: DataTypes.ENUM(...PRODUCT_CATEGORIES),
                allowNull: false,
            },
            sizes: {
                type: DataTypes.ARRAY(DataTypes.STRING),
                allowNull: false,
            },
            shortDescription: {
                type: DataTypes.STRING(200),
                allowNull: false,
            },
            longDescription: {
                type: DataTypes.TEXT,
            },
            available: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
            imageURL: DataTypes.STRING,
        },
        { sequelize }
    );
}
